-- Наличные или перевод у оплаты (задачи 1 и 18): «Итог дня» считает кассу
-- только по наличным. Новая колонка (пусто у старых оплат — тогда перевод,
-- если есть чек или номер перевода) и тот же commit_payment с p_method.
-- Данные не меняются.
begin;

alter table public.payments add column method text
  check (method is null or method in ('cash','transfer'));

-- Новый параметр — пересоздание функции (старая подпись удаляется, иначе
-- вызов без p_method стал бы неоднозначным).
drop function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz,text,text,text);
create function public.commit_payment(
  p_org uuid, p_direction text, p_party uuid, p_amount text, p_bank_reference text, p_idempotency_key uuid,
  p_document uuid default null, p_occurred_at timestamptz default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_method text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_payment uuid; v_amount numeric;
  v_customer uuid; v_supplier uuid; v_converted numeric; v_duplicate_of uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_party is null
    or p_direction not in ('incoming','outgoing')
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
    or (p_bank_reference is not null and (
      length(trim(p_bank_reference))>200 or trim(p_bank_reference)=''
    ))
  then raise exception 'invalid_payment'; end if;
  if p_method is not null and p_method not in ('cash','transfer') then raise exception 'invalid_payment'; end if;
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  -- Блокировка магазина: проверка «номер уже есть» и вставка не гоняются.
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  if p_direction='incoming' then
    if not exists(select 1 from public.customers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_customer:=p_party;
  else
    if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_supplier:=p_party;
  end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org, case when p_direction='incoming' then 'customers' else 'suppliers' end, p_party),
    p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_payment'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;

  -- Без даты и без исходной валюты хеш прежний.
  v_hash:=md5((jsonb_build_object(
    'direction',p_direction,'party',p_party,'amount',v_amount::text,
    'bank_reference',p_bank_reference,'document',p_document
  ) || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end
    || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='payment'
  ) then raise exception 'invalid_document'; end if;

  if nullif(trim(p_bank_reference),'') is not null then
    select id into v_duplicate_of from public.payments
    where organization_id=p_org and bank_reference=trim(p_bank_reference)
      and status in ('confirmed','pending') and reversed_at is null
    order by (status='confirmed') desc, created_at
    limit 1;
  end if;

  insert into public.payments(
    organization_id,customer_id,supplier_id,direction,amount,status,
    bank_reference,document_id,idempotency_key,request_hash,occurred_at,
    original_amount,original_currency,fx_rate,duplicate_of,method
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,
    case when v_duplicate_of is null then 'confirmed' else 'pending' end,
    nullif(trim(p_bank_reference),''),p_document,p_idempotency_key,v_hash,
    coalesce(p_occurred_at, now()),
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end,
    v_duplicate_of,
    -- Чек или номер перевода — перевод, даже если способ не выбран.
    coalesce(p_method, case when p_document is not null or nullif(trim(p_bank_reference),'') is not null then 'transfer' end)
  ) returning id into v_payment;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),
    case when v_duplicate_of is not null then 'payment.duplicate'
         when p_direction='incoming' then 'payment.received' else 'payment.paid' end,
    v_payment,jsonb_build_object('amount',v_amount::text,'direction',p_direction)
      || case when v_duplicate_of is null then '{}'::jsonb
              else jsonb_build_object('duplicate_of',v_duplicate_of) end);
  return v_payment;
end
$$;
revoke all on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz,text,text,text,text) to authenticated;

commit;
