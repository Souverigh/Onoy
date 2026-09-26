-- Depter Этап 1: сторно, заявки на оплату, ссылки клиента, фото-основание операций.
-- Товары/склад (products, inventory_movements, product_balances) не трогаем — Этап 2.
begin;

-- 0. Телефон магазина — нужен клиенту, чтобы написать в WhatsApp -----------

alter table public.organizations add column phone text not null default '' check (length(phone) <= 40);
grant update (name, phone) on public.organizations to authenticated;
create policy tenant_update on public.organizations for update to authenticated
  using (private.is_member(id)) with check (private.is_member(id));

-- 1. Статусы заявок и сторно ---------------------------------------------

alter table public.payments
  add column status text not null default 'confirmed'
    check (status in ('pending','confirmed','rejected')),
  add column reject_comment text
    check (reject_comment is null or length(trim(reject_comment)) between 1 and 2000),
  add column claim_comment text
    check (claim_comment is null or length(trim(claim_comment)) between 1 and 2000),
  add column reversed_at timestamptz,
  add column reversed_by uuid references auth.users(id),
  add column reversal_comment text,
  add constraint payments_reversal_consistent check (
    (reversed_at is null and reversed_by is null and reversal_comment is null)
    or (reversed_at is not null and reversed_by is not null
        and reversal_comment is not null and length(trim(reversal_comment)) > 0)
  ),
  add constraint payments_reject_consistent check (
    (status = 'rejected') = (reject_comment is not null)
  );

alter table public.sales
  add column reversed_at timestamptz,
  add column reversed_by uuid references auth.users(id),
  add column reversal_comment text,
  add constraint sales_reversal_consistent check (
    (reversed_at is null and reversed_by is null and reversal_comment is null)
    or (reversed_at is not null and reversed_by is not null
        and reversal_comment is not null and length(trim(reversal_comment)) > 0)
  );

alter table public.purchases
  add column reversed_at timestamptz,
  add column reversed_by uuid references auth.users(id),
  add column reversal_comment text,
  add constraint purchases_reversal_consistent check (
    (reversed_at is null and reversed_by is null and reversal_comment is null)
    or (reversed_at is not null and reversed_by is not null
        and reversal_comment is not null and length(trim(reversal_comment)) > 0)
  );

grant update (status, reject_comment, reversed_at, reversed_by, reversal_comment)
  on public.payments to authenticated;
grant update (reversed_at, reversed_by, reversal_comment) on public.sales to authenticated;
grant update (reversed_at, reversed_by, reversal_comment) on public.purchases to authenticated;

-- Только подтверждённые и не сторнированные записи двигают долг.
create or replace view public.customer_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.sales s
       where s.organization_id=c.organization_id and s.customer_id=c.id
         and s.status='posted' and not s.paid_immediately and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.customer_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.customers c;

create or replace view public.supplier_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.purchases s
       where s.organization_id=c.organization_id and s.supplier_id=c.id
         and s.status='posted' and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.supplier_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.suppliers c;

-- 2. Привязка фото к операции --------------------------------------------

-- Старые сигнатуры без p_document заменяются, а не перегружаются.
drop function if exists public.commit_purchase(uuid,uuid,text,uuid);
drop function if exists public.commit_sale(uuid,uuid,text,boolean,uuid);
drop function if exists public.commit_payment(uuid,text,uuid,text,text,uuid);

create or replace function public.commit_purchase(
  p_org uuid, p_supplier uuid, p_amount text, p_idempotency_key uuid,
  p_document uuid default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_purchase uuid; v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_supplier is null
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_purchase'; end if;
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_purchase'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash:=md5(jsonb_build_object('supplier_id',p_supplier,'amount',v_amount::text,'document',p_document)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.purchases where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_supplier)
  then raise exception 'invalid_supplier'; end if;
  if p_document is not null and not exists(
    select 1 from public.documents
    where organization_id=p_org and id=p_document and kind='purchase'
  ) then raise exception 'invalid_document'; end if;

  insert into public.purchases(
    organization_id,supplier_id,status,total,document_id,idempotency_key,request_hash
  ) values(p_org,p_supplier,'posted',v_amount,p_document,p_idempotency_key,v_hash)
  returning id into v_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,jsonb_build_object('total',v_amount::text));
  return v_purchase;
end
$$;

create or replace function public.commit_sale(
  p_org uuid, p_customer uuid, p_amount text, p_paid_immediately boolean, p_idempotency_key uuid,
  p_document uuid default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_sale uuid; v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_customer is null or p_paid_immediately is null
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_sale'; end if;
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_sale'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash:=md5(jsonb_build_object(
    'customer_id',p_customer,'amount',v_amount::text,
    'paid_immediately',p_paid_immediately,'document',p_document
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_customer'; end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='sale'
  ) then raise exception 'invalid_document'; end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,document_id,idempotency_key,request_hash
  ) values(p_org,p_customer,'posted',v_amount,p_paid_immediately,p_document,p_idempotency_key,v_hash)
  returning id into v_sale;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.posted',v_sale,
    jsonb_build_object('total',v_amount::text,'paid_immediately',p_paid_immediately));
  return v_sale;
end
$$;

create or replace function public.commit_payment(
  p_org uuid, p_direction text, p_party uuid, p_amount text, p_bank_reference text, p_idempotency_key uuid,
  p_document uuid default null
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
  v_amount:=p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_hash:=md5(jsonb_build_object(
    'direction',p_direction,'party',p_party,'amount',v_amount::text,
    'bank_reference',p_bank_reference,'document',p_document
  )::text);
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
    bank_reference,document_id,idempotency_key,request_hash
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,'confirmed',
    nullif(trim(p_bank_reference),''),p_document,p_idempotency_key,v_hash
  ) returning id into v_payment;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),
    case when p_direction='incoming' then 'payment.received' else 'payment.paid' end,
    v_payment,jsonb_build_object('amount',v_amount::text,'direction',p_direction));
  return v_payment;
end
$$;

revoke all on function public.commit_purchase(uuid,uuid,text,uuid,uuid) from public,anon;
revoke all on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid) from public,anon;
revoke all on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.commit_purchase(uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid) to authenticated;
grant execute on function public.commit_payment(uuid,text,uuid,text,text,uuid,uuid) to authenticated;

-- `documents` только читается (grant select) — вставка идёт через эту RPC,
-- как и остальные проведения, а не прямой insert с клиента.
create function public.create_document(
  p_org uuid, p_kind text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('purchase','sale','payment') then raise exception 'invalid_kind'; end if;
  if p_storage_path is null or length(trim(p_storage_path))=0
    or p_file_hash is null or length(trim(p_file_hash))=0
    or p_mime_type is null or length(trim(p_mime_type))=0
  then raise exception 'invalid_document'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  insert into public.documents(organization_id,storage_path,file_hash,mime_type,kind,status)
  values(p_org,p_storage_path,p_file_hash,p_mime_type,p_kind,'uploaded')
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.create_document(uuid,text,text,text,text) from public,anon;
grant execute on function public.create_document(uuid,text,text,text,text) to authenticated;

-- 3. Сторно ----------------------------------------------------------------

create function public.reverse_sale(p_org uuid, p_sale uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.sales set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=trim(p_comment)
  where organization_id=p_org and id=p_sale and reversed_at is null;
  if not found then raise exception 'invalid_sale'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.reversed',p_sale,jsonb_build_object('comment',trim(p_comment)));
end
$$;

create function public.reverse_purchase(p_org uuid, p_purchase uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.purchases set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=trim(p_comment)
  where organization_id=p_org and id=p_purchase and reversed_at is null;
  if not found then raise exception 'invalid_purchase'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.reversed',p_purchase,jsonb_build_object('comment',trim(p_comment)));
end
$$;

create function public.reverse_payment(p_org uuid, p_payment uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.payments set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=trim(p_comment)
  where organization_id=p_org and id=p_payment and reversed_at is null and status='confirmed';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.reversed',p_payment,jsonb_build_object('comment',trim(p_comment)));
end
$$;

revoke all on function public.reverse_sale(uuid,uuid,text) from public,anon;
revoke all on function public.reverse_purchase(uuid,uuid,text) from public,anon;
revoke all on function public.reverse_payment(uuid,uuid,text) from public,anon;
grant execute on function public.reverse_sale(uuid,uuid,text) to authenticated;
grant execute on function public.reverse_purchase(uuid,uuid,text) to authenticated;
grant execute on function public.reverse_payment(uuid,uuid,text) to authenticated;

-- 4. Заявки клиента на оплату («Я оплатил») --------------------------------

create function public.confirm_payment_claim(p_org uuid, p_payment uuid, p_amount text) returns void
language plpgsql security definer set search_path='' as $$
declare v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  v_amount := coalesce(p_amount, (select amount::text from public.payments where organization_id=p_org and id=p_payment))::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;
  update public.payments set status='confirmed', amount=v_amount
  where organization_id=p_org and id=p_payment and status='pending';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_confirmed',p_payment,jsonb_build_object('amount',v_amount::text));
end
$$;

create function public.reject_payment_claim(p_org uuid, p_payment uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.payments set status='rejected', reject_comment=trim(p_comment)
  where organization_id=p_org and id=p_payment and status='pending';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_rejected',p_payment,jsonb_build_object('comment',trim(p_comment)));
end
$$;

revoke all on function public.confirm_payment_claim(uuid,uuid,text) from public,anon;
revoke all on function public.reject_payment_claim(uuid,uuid,text) from public,anon;
grant execute on function public.confirm_payment_claim(uuid,uuid,text) to authenticated;
grant execute on function public.reject_payment_claim(uuid,uuid,text) to authenticated;

-- 5. Ссылка клиента без входа -----------------------------------------------

create table public.share_links(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customer_id uuid not null,
  -- 32 hex chars from a v4 UUID: ~122 bits of randomness, no pgcrypto needed.
  token text not null unique default replace(gen_random_uuid()::text,'-',''),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key(organization_id,customer_id) references public.customers(organization_id,id)
);
create index share_links_org_customer_idx on public.share_links(organization_id,customer_id);
alter table public.share_links enable row level security;
revoke all on public.share_links from anon, authenticated;
grant select on public.share_links to authenticated;
create policy tenant_read on public.share_links for select to authenticated using (private.is_member(organization_id));

create function public.create_share_link(p_org uuid, p_customer uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_customer'; end if;
  select token into v_token from public.share_links
  where organization_id=p_org and customer_id=p_customer and revoked_at is null
  order by created_at desc limit 1;
  if v_token is not null then return v_token; end if;
  insert into public.share_links(organization_id,customer_id) values(p_org,p_customer)
  returning token into v_token;
  return v_token;
end
$$;

create function public.revoke_share_link(p_org uuid, p_link uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  update public.share_links set revoked_at=now()
  where organization_id=p_org and id=p_link and revoked_at is null;
  if not found then raise exception 'invalid_link'; end if;
end
$$;

revoke all on function public.create_share_link(uuid,uuid) from public,anon;
revoke all on function public.revoke_share_link(uuid,uuid) from public,anon;
grant execute on function public.create_share_link(uuid,uuid) to authenticated;
grant execute on function public.revoke_share_link(uuid,uuid) to authenticated;

-- Публичный, анонимный доступ строго по токену — без auth.uid(), без RLS-обхода таблиц.
create function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_shop_name text; v_shop_phone text; v_balance text;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select l.*, c.name as customer_name, c.phone as customer_phone
  into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  select o.name, o.phone into v_shop_name, v_shop_phone from public.organizations o where o.id=v_link.organization_id;
  select balance into v_balance from public.customer_balances
  where organization_id=v_link.organization_id and id=v_link.customer_id;
  return jsonb_build_object(
    'shop_name', v_shop_name,
    'shop_phone', v_shop_phone,
    'customer_name', v_link.customer_name,
    'balance', coalesce(v_balance,'0'),
    'entries', (
      select coalesce(jsonb_agg(entry order by entry->>'occurred_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('kind','sale','id',id,'amount',total::text,
          'occurred_at',occurred_at,'reversed',reversed_at is not null,'paid_immediately',paid_immediately) as entry
        from public.sales where organization_id=v_link.organization_id and customer_id=v_link.customer_id and status='posted'
        union all
        select jsonb_build_object('kind','payment','id',id,'amount',amount::text,
          'occurred_at',occurred_at,'reversed',reversed_at is not null,'status',status) as entry
        from public.payments where organization_id=v_link.organization_id and customer_id=v_link.customer_id
      ) rows
    )
  );
end
$$;

create function public.submit_payment_claim(
  p_token text, p_amount text, p_comment text, p_receipt_document uuid default null
) returns void
language plpgsql security definer set search_path='' as $$
declare v_link record; v_amount numeric;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select * into v_link from public.share_links where token=p_token and revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_amount'; end if;
  v_amount := p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_amount'; end if;
  if p_receipt_document is not null and not exists(
    select 1 from public.documents
    where organization_id=v_link.organization_id and id=p_receipt_document and kind='payment'
  ) then raise exception 'invalid_document'; end if;

  insert into public.payments(
    organization_id,customer_id,direction,amount,status,claim_comment,document_id,idempotency_key
  ) values(
    v_link.organization_id, v_link.customer_id, 'incoming', v_amount, 'pending',
    nullif(trim(coalesce(p_comment,'')),''), p_receipt_document, gen_random_uuid()
  );
  insert into public.audit_events(organization_id,action,entity_id,metadata)
  values(v_link.organization_id,'payment.claim_submitted',v_link.customer_id,
    jsonb_build_object('amount',v_amount::text,'comment',left(coalesce(p_comment,''),2000)));
end
$$;

create function public.create_claim_document(
  p_token text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_id uuid;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select organization_id into v_org from public.share_links where token=p_token and revoked_at is null;
  if v_org is null then raise exception 'invalid_token'; end if;
  if p_storage_path is null or length(trim(p_storage_path))=0
    or p_file_hash is null or length(trim(p_file_hash))=0
    or p_mime_type is null or length(trim(p_mime_type))=0
  then raise exception 'invalid_document'; end if;
  insert into public.documents(organization_id,storage_path,file_hash,mime_type,kind,status)
  values(v_org,p_storage_path,p_file_hash,p_mime_type,'payment','uploaded')
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.create_claim_document(text,text,text,text) from public,authenticated;
grant execute on function public.create_claim_document(text,text,text,text) to anon;

revoke all on function public.get_statement_by_token(text) from public,anon,authenticated;
revoke all on function public.submit_payment_claim(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.get_statement_by_token(text) to anon, authenticated;
grant execute on function public.submit_payment_claim(text,text,text,uuid) to anon, authenticated;

-- 6. Хранилище фото (bucket + RLS). Схема storage существует только в
-- реальном Supabase-проекте, поэтому блок no-op под тестовым PGlite.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('receipts','receipts', false)
    on conflict (id) do nothing;

    create policy "org members upload receipts" on storage.objects
      for insert to authenticated with check (
        bucket_id = 'receipts'
        and private.is_member(((storage.foldername(name))[1])::uuid)
      );
    create policy "org members read receipts" on storage.objects
      for select to authenticated using (
        bucket_id = 'receipts'
        and private.is_member(((storage.foldername(name))[1])::uuid)
      );
    -- Путь для чека клиента: receipts/claims/<token>/... Анонимная загрузка
    -- разрешена только по действующему (не отозванному) токену.
    create policy "clients upload claim receipts by token" on storage.objects
      for insert to anon with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = 'claims'
        and exists (
          select 1 from public.share_links l
          where l.token = (storage.foldername(name))[2]
            and l.revoked_at is null
        )
      );
    create policy "org members read claim receipts" on storage.objects
      for select to authenticated using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = 'claims'
        and exists (
          select 1 from public.share_links l
          where l.token = (storage.foldername(name))[2]
            and private.is_member(l.organization_id)
        )
      );
  end if;
end
$$;

commit;
