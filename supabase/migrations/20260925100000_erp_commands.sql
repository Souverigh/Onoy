begin;

alter table public.sales
  add column paid_immediately boolean not null default false;

create or replace view public.customer_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total)
       from public.sales s
       where s.organization_id=c.organization_id
         and s.customer_id=c.id
         and s.status='posted'
         and not s.paid_immediately
     ),0)
     - coalesce((
       select sum(p.amount)
       from public.payments p
       where p.organization_id=c.organization_id and p.customer_id=c.id
     ),0)
   )::text as balance
 from public.customers c;

create function public.commit_purchase(
  p_org uuid,
  p_supplier uuid,
  p_amount text,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_hash text;
  v_existing uuid;
  v_existing_hash text;
  v_purchase uuid;
  v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_supplier is null
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_purchase'; end if;
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then
    raise exception 'invalid_purchase';
  end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash:=md5(jsonb_build_object('supplier_id',p_supplier,'amount',v_amount::text)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.purchases
  where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then
      raise exception 'idempotency_conflict';
    end if;
    return v_existing;
  end if;
  if not exists(
    select 1 from public.suppliers
    where organization_id=p_org and id=p_supplier
  ) then raise exception 'invalid_supplier'; end if;

  insert into public.purchases(
    organization_id,supplier_id,status,total,idempotency_key,request_hash
  ) values(p_org,p_supplier,'posted',v_amount,p_idempotency_key,v_hash)
  returning id into v_purchase;
  insert into public.audit_events(
    organization_id,actor_id,action,entity_id,metadata
  ) values(
    p_org,auth.uid(),'purchase.posted',v_purchase,
    jsonb_build_object('total',v_amount::text)
  );
  return v_purchase;
end
$$;

create function public.commit_sale(
  p_org uuid,
  p_customer uuid,
  p_amount text,
  p_paid_immediately boolean,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_hash text;
  v_existing uuid;
  v_existing_hash text;
  v_sale uuid;
  v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_customer is null
    or p_paid_immediately is null
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_sale'; end if;
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then
    raise exception 'invalid_sale';
  end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash:=md5(jsonb_build_object(
    'customer_id',p_customer,
    'amount',v_amount::text,
    'paid_immediately',p_paid_immediately
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales
  where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then
      raise exception 'idempotency_conflict';
    end if;
    return v_existing;
  end if;
  if not exists(
    select 1 from public.customers
    where organization_id=p_org and id=p_customer
  ) then raise exception 'invalid_customer'; end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,
    idempotency_key,request_hash
  ) values(
    p_org,p_customer,'posted',v_amount,p_paid_immediately,
    p_idempotency_key,v_hash
  ) returning id into v_sale;
  insert into public.audit_events(
    organization_id,actor_id,action,entity_id,metadata
  ) values(
    p_org,auth.uid(),'sale.posted',v_sale,
    jsonb_build_object(
      'total',v_amount::text,
      'paid_immediately',p_paid_immediately
    )
  );
  return v_sale;
end
$$;

create function public.commit_payment(
  p_org uuid,
  p_direction text,
  p_party uuid,
  p_amount text,
  p_bank_reference text,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_hash text;
  v_existing uuid;
  v_existing_hash text;
  v_payment uuid;
  v_amount numeric;
  v_customer uuid;
  v_supplier uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_party is null
    or p_direction not in ('incoming','outgoing')
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or (p_bank_reference is not null and (
      length(trim(p_bank_reference))>200 or trim(p_bank_reference)=''
    ))
  then raise exception 'invalid_payment'; end if;
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then
    raise exception 'invalid_payment';
  end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash:=md5(jsonb_build_object(
    'direction',p_direction,
    'party',p_party,
    'amount',v_amount::text,
    'bank_reference',p_bank_reference
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments
  where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then
      raise exception 'idempotency_conflict';
    end if;
    return v_existing;
  end if;

  if p_direction='incoming' then
    if not exists(
      select 1 from public.customers
      where organization_id=p_org and id=p_party
    ) then raise exception 'invalid_party'; end if;
    v_customer:=p_party;
  else
    if not exists(
      select 1 from public.suppliers
      where organization_id=p_org and id=p_party
    ) then raise exception 'invalid_party'; end if;
    v_supplier:=p_party;
  end if;

  insert into public.payments(
    organization_id,customer_id,supplier_id,direction,amount,
    bank_reference,idempotency_key,request_hash
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,
    nullif(trim(p_bank_reference),''),p_idempotency_key,v_hash
  ) returning id into v_payment;
  insert into public.audit_events(
    organization_id,actor_id,action,entity_id,metadata
  ) values(
    p_org,auth.uid(),
    case when p_direction='incoming' then 'payment.received' else 'payment.paid' end,
    v_payment,
    jsonb_build_object('amount',v_amount::text,'direction',p_direction)
  );
  return v_payment;
end
$$;

revoke all on function public.commit_purchase(uuid,uuid,text,uuid) from public,anon;
revoke all on function public.commit_sale(uuid,uuid,text,boolean,uuid) from public,anon;
revoke all on function public.commit_payment(uuid,text,uuid,text,text,uuid) from public,anon;
grant execute on function public.commit_purchase(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.commit_sale(uuid,uuid,text,boolean,uuid) to authenticated;
grant execute on function public.commit_payment(uuid,text,uuid,text,text,uuid) to authenticated;

commit;
