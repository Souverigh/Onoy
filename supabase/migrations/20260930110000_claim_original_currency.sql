-- Оплата клиента в другой валюте (10 $ при долге в ₽):
-- 1) клиент на своей странице видит её как 10 $, пересчёт — подсказкой:
--    выписка по токену дописывает originals {id: {amount, currency, rate}}
--    для оплат этого клиента (тело выписки — private.*_unchecked — не меняем);
-- 2) владелец при подтверждении может поменять курс (или исходную сумму):
--    сумма в валюте долга пересчитывается в базе, исходная сумма остаётся.
--    Только сумма (без исходной) — как раньше: исходная и курс снимаются.
-- Существующие строки не меняются.
begin;

create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_currency text; v_originals jsonb;
begin
  select * into v_link from public.share_links l where l.token=p_token and l.revoked_at is null;
  if found then
    v_currency := private.party_currency(v_link.organization_id,'customers',v_link.customer_id);
    select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
      'amount', p.original_amount::text, 'currency', p.original_currency, 'rate', p.fx_rate::text)), '{}'::jsonb)
    into v_originals
    from public.payments p
    where p.organization_id=v_link.organization_id and p.customer_id=v_link.customer_id
      and p.original_currency is not null;
  end if;
  return private.get_statement_by_token_unchecked(p_token)
    || jsonb_build_object('currency', coalesce(v_currency,'KGS'), 'originals', coalesce(v_originals,'{}'::jsonb));
end
$$;

drop function public.confirm_payment_claim(uuid,uuid,text);
create function public.confirm_payment_claim(
  p_org uuid, p_payment uuid, p_amount text,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null
) returns void
language plpgsql security definer set search_path='' as $$
declare v_pay record; v_amount numeric; v_converted numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select * into v_pay from public.payments where organization_id=p_org and id=p_payment and status='pending' for update;
  if not found then raise exception 'invalid_payment'; end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org, case when v_pay.customer_id is not null then 'customers' else 'suppliers' end,
      coalesce(v_pay.customer_id, v_pay.supplier_id)),
    p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else v_amount := coalesce(p_amount, v_pay.amount::text)::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;
  if v_converted is not null then
    update public.payments set status='confirmed', amount=v_amount,
      original_amount=p_original_amount::numeric, original_currency=p_original_currency, fx_rate=p_fx_rate::numeric
    where organization_id=p_org and id=p_payment;
  else
    -- Сумма исправлена владельцем в валюте долга — она уже не «исходная × курс».
    update public.payments set status='confirmed', amount=v_amount,
      original_amount=case when amount=v_amount then original_amount end,
      original_currency=case when amount=v_amount then original_currency end,
      fx_rate=case when amount=v_amount then fx_rate end
    where organization_id=p_org and id=p_payment;
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_confirmed',p_payment,jsonb_build_object('amount',v_amount::text)
    || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',p_original_amount,'original_currency',p_original_currency,'fx_rate',p_fx_rate) end);
end
$$;
revoke all on function public.confirm_payment_claim(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.confirm_payment_claim(uuid,uuid,text,text,text,text) to authenticated;

commit;
