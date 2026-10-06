-- «Заявки» (задача 19): после «Подтвердить» 5 секунд можно «Вернуть».
-- Подтверждение запоминает в журнале, какой заявка была до него;
-- undo_confirm_claim возвращает её в «ждёт подтверждения» — только
-- владелец, только своё подтверждение и только в первую минуту. Пишет
-- audit_events. Функции — данные не меняются.
begin;

create or replace function public.confirm_payment_claim(
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
    -- Как было до подтверждения — для «Вернуть» (undo_confirm_claim).
    || jsonb_build_object('before', jsonb_build_object(
      'amount', v_pay.amount::text, 'original_amount', v_pay.original_amount::text,
      'original_currency', v_pay.original_currency, 'fx_rate', v_pay.fx_rate::text))
    || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',p_original_amount,'original_currency',p_original_currency,'fx_rate',p_fx_rate) end);
end
$$;
revoke all on function public.confirm_payment_claim(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.confirm_payment_claim(uuid,uuid,text,text,text,text) to authenticated;

create function public.undo_confirm_claim(p_org uuid, p_payment uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_event record; v_before jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select e.actor_id, e.created_at, e.metadata into v_event from public.audit_events e
  where e.organization_id=p_org and e.entity_id=p_payment and e.action='payment.claim_confirmed'
  order by e.created_at desc limit 1;
  if not found or v_event.actor_id is distinct from auth.uid() or v_event.created_at < now() - interval '1 minute'
    or v_event.metadata->'before' is null
  then raise exception 'undo_expired'; end if;
  v_before := v_event.metadata->'before';
  update public.payments set status='pending',
    amount=(v_before->>'amount')::numeric,
    original_amount=(v_before->>'original_amount')::numeric,
    original_currency=v_before->>'original_currency',
    fx_rate=(v_before->>'fx_rate')::numeric
  where organization_id=p_org and id=p_payment and status='confirmed' and reversed_at is null;
  if not found then raise exception 'undo_expired'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_unconfirmed',p_payment,'{}'::jsonb);
end
$$;
revoke all on function public.undo_confirm_claim(uuid,uuid) from public, anon;
grant execute on function public.undo_confirm_claim(uuid,uuid) to authenticated;

commit;
