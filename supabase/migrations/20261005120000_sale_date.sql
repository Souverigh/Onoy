-- Дата продажи (задача 15): «сегодня» или другой день, как у оплаты.
-- Пересоздание commit_sale с p_occurred_at; данные не меняются.
begin;

drop function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text);
create function public.commit_sale(
  p_org uuid, p_customer uuid, p_amount text, p_paid_immediately boolean, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_sale uuid; v_amount numeric;
  v_converted numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_customer is null or p_paid_immediately is null
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
  then raise exception 'invalid_sale'; end if;
  -- Продажа за прошлый день (задача 15): не в будущем и не старше года.
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_customer'; end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org,'customers',p_customer), p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_sale'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_sale'; end if;

  v_hash:=md5((jsonb_build_object(
    'customer_id',p_customer,'amount',v_amount::text,
    'paid_immediately',p_paid_immediately,'document',p_document
  ) || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end
    || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='sale'
  ) then raise exception 'invalid_document'; end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,document_id,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate,occurred_at
  ) values(p_org,p_customer,'posted',v_amount,p_paid_immediately,p_document,p_idempotency_key,v_hash,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end,
    coalesce(p_occurred_at, now()))
  returning id into v_sale;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.posted',v_sale,
    jsonb_build_object('total',v_amount::text,'paid_immediately',p_paid_immediately));
  return v_sale;
end
$$;
revoke all on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz) from public,anon;
grant execute on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz) to authenticated;

commit;
