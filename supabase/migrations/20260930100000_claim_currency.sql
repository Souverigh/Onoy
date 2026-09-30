-- Заявка клиента «Я оплатил» в другой валюте: долг Ержана в ₽, а перевёл он
-- 1 250 сом — страница клиента спрашивала сумму только в валюте долга.
-- Теперь клиент выбирает валюту; сервер (не клиент) подставляет курс
-- НБКР / ЦБ РФ, сумма в валюте долга считается в базе, исходная сумма и
-- курс хранятся (как у записей продавца, currencies.sql). Владелец,
-- поменявший сумму при подтверждении, записывает её уже в валюте долга —
-- тогда исходная сумма и курс снимаются. Существующие строки не меняются.
begin;

drop function public.submit_payment_claim(text,text,text,uuid);
create function public.submit_payment_claim(
  p_token text, p_amount text, p_comment text, p_receipt_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_link record; v_amount numeric; v_converted numeric; v_id uuid; v_duplicate_of uuid;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select * into v_link from public.share_links where token=p_token and revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  v_converted := private.converted_amount(
    private.party_currency(v_link.organization_id, 'customers', v_link.customer_id),
    p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_amount'; end if;
    v_amount := p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_amount'; end if;
  if p_receipt_document is not null and not exists(
    select 1 from public.documents
    where organization_id=v_link.organization_id and id=p_receipt_document and kind='payment'
  ) then raise exception 'invalid_document'; end if;

  -- То же фото квитанции уже приложено к действующей оплате магазина;
  -- если та сама дубликат — ссылаемся на исходную (как в миграции 34).
  if p_receipt_document is not null then
    select coalesce(p.duplicate_of, p.id) into v_duplicate_of
    from public.documents mine
    join public.documents d on d.organization_id=mine.organization_id and d.file_hash=mine.file_hash
      and d.id<>mine.id
    join public.payments p on p.organization_id=d.organization_id and p.document_id=d.id
    where mine.organization_id=v_link.organization_id and mine.id=p_receipt_document
      and p.status in ('confirmed','pending') and p.reversed_at is null
    order by (p.status='confirmed') desc, (p.duplicate_of is null) desc, p.created_at
    limit 1;
  end if;

  insert into public.payments(
    organization_id,customer_id,direction,amount,status,claim_comment,document_id,idempotency_key,duplicate_of,
    original_amount,original_currency,fx_rate
  ) values(
    v_link.organization_id, v_link.customer_id, 'incoming', v_amount, 'pending',
    nullif(trim(coalesce(p_comment,'')),''), p_receipt_document, gen_random_uuid(), v_duplicate_of,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end
  ) returning id into v_id;
  insert into public.audit_events(organization_id,action,entity_id,metadata)
  values(v_link.organization_id,'payment.claim_submitted',v_link.customer_id,
    jsonb_build_object('amount',v_amount::text,'comment',left(coalesce(p_comment,''),2000))
    || case when v_duplicate_of is null then '{}'::jsonb
            else jsonb_build_object('duplicate_of',v_duplicate_of) end
    || case when v_converted is null then '{}'::jsonb
            else jsonb_build_object('original_amount',p_original_amount,'original_currency',p_original_currency,'fx_rate',p_fx_rate) end);
  return v_id;
end
$$;
revoke all on function public.submit_payment_claim(text,text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_payment_claim(text,text,text,uuid,text,text,text) to anon, authenticated;

create or replace function public.confirm_payment_claim(p_org uuid, p_payment uuid, p_amount text) returns void
language plpgsql security definer set search_path='' as $$
declare v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  v_amount := coalesce(p_amount, (select amount::text from public.payments where organization_id=p_org and id=p_payment))::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;
  -- Сумма исправлена владельцем — она уже не «исходная × курс».
  update public.payments set status='confirmed', amount=v_amount,
    original_amount=case when amount=v_amount then original_amount end,
    original_currency=case when amount=v_amount then original_currency end,
    fx_rate=case when amount=v_amount then fx_rate end
  where organization_id=p_org and id=p_payment and status='pending';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_confirmed',p_payment,jsonb_build_object('amount',v_amount::text));
end
$$;

commit;
