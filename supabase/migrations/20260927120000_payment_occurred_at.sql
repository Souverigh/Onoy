-- Дата оплаты из чека: commit_payment принимает p_occurred_at (время
-- перевода по квитанции). Без неё — как раньше, now(). Не в будущем (запас
-- 10 минут на расхождение часов) и не старше года. Тело — как в
-- debt_ledger.sql; существующие записи не меняются.
begin;

drop function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid);

create function public.commit_payment(
  p_org uuid, p_direction text, p_party uuid, p_amount text, p_bank_reference text, p_idempotency_key uuid,
  p_document uuid default null, p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_payment uuid; v_amount numeric;
  v_customer uuid; v_supplier uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_party is null
    or p_direction not in ('incoming','outgoing')
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or (p_bank_reference is not null and (
      length(trim(p_bank_reference))>200 or trim(p_bank_reference)=''
    ))
  then raise exception 'invalid_payment'; end if;
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  -- Без даты хеш прежний — повтор запроса, начатого до миграции, узнаётся.
  v_hash:=md5((jsonb_build_object(
    'direction',p_direction,'party',p_party,'amount',v_amount::text,
    'bank_reference',p_bank_reference,'document',p_document
  ) || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  if p_direction='incoming' then
    if not exists(select 1 from public.customers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_customer:=p_party;
  else
    if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_supplier:=p_party;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='payment'
  ) then raise exception 'invalid_document'; end if;

  insert into public.payments(
    organization_id,customer_id,supplier_id,direction,amount,status,
    bank_reference,document_id,idempotency_key,request_hash,occurred_at
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,'confirmed',
    nullif(trim(p_bank_reference),''),p_document,p_idempotency_key,v_hash,
    coalesce(p_occurred_at, now())
  ) returning id into v_payment;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),
    case when p_direction='incoming' then 'payment.received' else 'payment.paid' end,
    v_payment,jsonb_build_object('amount',v_amount::text,'direction',p_direction));
  return v_payment;
end
$$;
revoke all on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid,timestamptz) to authenticated;

commit;
