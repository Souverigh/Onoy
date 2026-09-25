-- Oŋoy foundation. Apply only to a dedicated Supabase project.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 currency text not null default 'KGS' check(currency='KGS'), timezone text not null default 'Asia/Bishkek',
 created_by uuid not null references auth.users(id), creation_key uuid not null,
 created_at timestamptz not null default now(), unique(created_by,creation_key)
);
create table public.organization_members (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 role text not null default 'owner' check(role in ('owner','staff')), created_at timestamptz not null default now(),
 primary key(organization_id,user_id)
);
create index organization_members_user_idx on public.organization_members(user_id,organization_id);
create table public.customers (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 name text not null check(length(trim(name)) between 1 and 160), phone text not null default '' check(length(phone)<=40),
 aliases text[] not null default '{}', notes text not null default '' check(length(notes)<=2000)
 );
create table public.suppliers (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 name text not null check(length(trim(name)) between 1 and 160), phone text not null default '' check(length(phone)<=40),
 aliases text[] not null default '{}', notes text not null default '' check(length(notes)<=2000)
 );
create table public.products (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 name text not null check(length(trim(name)) between 1 and 160), sku text check(length(sku)<=80), aliases text[] not null default '{}',
 unit text not null default 'шт' check(unit in ('шт','м','кг','упак','л')),
 purchase_price numeric(16,2) not null default 0 check(purchase_price>=0 and purchase_price<1e14),
 sale_price numeric(16,2) not null default 0 check(sale_price>=0 and sale_price<1e14),
 min_stock numeric(16,3) not null default 0 check(min_stock>=0 and min_stock<1e13), unique(organization_id,sku)
);
create table public.documents (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 storage_path text not null, file_hash text not null, mime_type text not null,
 status text not null default 'uploaded' check(status in ('uploaded','processing','review','committed','failed')),
 kind text check(kind in ('purchase','sale','payment')), error_message text, unique(organization_id,file_hash)
);
create table public.document_extractions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 document_id uuid not null, payload jsonb not null, model_version text not null,
 foreign key(organization_id,document_id) references public.documents(organization_id,id)
);
create table public.sales (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 customer_id uuid not null, occurred_at timestamptz not null default now(),
 status text not null default 'draft' check(status in ('draft','posted')),
 total numeric(16,2) not null check(total>=0 and total<1e14), document_id uuid,
 idempotency_key uuid not null, request_hash text,
 unique(organization_id,idempotency_key), unique(organization_id,document_id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id),
 foreign key(organization_id,document_id) references public.documents(organization_id,id)
 );
create table public.purchases (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 supplier_id uuid not null, occurred_at timestamptz not null default now(),
 status text not null default 'draft' check(status in ('draft','posted')),
 total numeric(16,2) not null check(total>=0 and total<1e14), document_id uuid,
 idempotency_key uuid not null, request_hash text,
 unique(organization_id,idempotency_key), unique(organization_id,document_id),
 foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id),
 foreign key(organization_id,document_id) references public.documents(organization_id,id)
 );
create table public.sale_items (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 sale_id uuid not null, product_id uuid not null, name_snapshot text not null,
 qty numeric(16,3) not null check(qty>0 and qty<1e13), price numeric(16,2) not null check(price>=0 and price<1e14),
 line_total numeric(16,2) generated always as (round(qty*price,2)) stored,
 foreign key(organization_id,sale_id) references public.sales(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
 );
create table public.purchase_items (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 purchase_id uuid not null, product_id uuid not null, name_snapshot text not null,
 qty numeric(16,3) not null check(qty>0 and qty<1e13), price numeric(16,2) not null check(price>=0 and price<1e14),
 line_total numeric(16,2) generated always as (round(qty*price,2)) stored,
 foreign key(organization_id,purchase_id) references public.purchases(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
 );
create table public.inventory_movements (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 product_id uuid not null, qty_delta numeric(16,3) not null check(qty_delta<>0 and abs(qty_delta)<1e13),
 reason text not null check(reason in ('purchase','sale','opening','adjustment')), purchase_id uuid, sale_id uuid,
 foreign key(organization_id,product_id) references public.products(organization_id,id),
 foreign key(organization_id,purchase_id) references public.purchases(organization_id,id),
 foreign key(organization_id,sale_id) references public.sales(organization_id,id),
 check((reason='sale' and sale_id is not null and purchase_id is null and qty_delta<0) or
 (reason='purchase' and purchase_id is not null and sale_id is null and qty_delta>0) or
 (reason in ('opening','adjustment') and purchase_id is null and sale_id is null))
);
create table public.payments (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 customer_id uuid, supplier_id uuid, direction text not null check(direction in ('incoming','outgoing')),
 amount numeric(16,2) not null check(amount>0 and amount<1e14), occurred_at timestamptz not null default now(),
 bank_reference text check(bank_reference is null or length(trim(bank_reference))>0), fingerprint text, document_id uuid,
 idempotency_key uuid not null, request_hash text,
 unique(organization_id,idempotency_key),unique(organization_id,bank_reference),unique(organization_id,fingerprint),unique(organization_id,document_id),
 foreign key(organization_id,customer_id) references public.customers(organization_id,id),
 foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id),
 foreign key(organization_id,document_id) references public.documents(organization_id,id),
 check((direction='incoming' and customer_id is not null and supplier_id is null) or (direction='outgoing' and supplier_id is not null and customer_id is null))
);
create table public.audit_events (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), created_at timestamptz not null default now(), unique(organization_id,id),
 actor_id uuid references auth.users(id), action text not null, entity_id uuid, metadata jsonb not null default '{}'
);
-- Live membership, never user-editable JWT metadata. Private helper avoids recursive RLS.
create function private.is_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid());
$$;
revoke all on function private.is_member(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;
-- Controlled privileged implementation; public wrapper runs as the caller.
create function private.create_organization(org_name text, request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare org_id uuid; uid uuid := auth.uid();
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if request_key is null or length(trim(org_name)) not between 1 and 120 or org_name is null then raise exception 'Invalid organization'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into org_id from public.organizations where created_by=uid and creation_key=request_key;
 if org_id is not null then return org_id; end if;
 if (select count(*) from public.organizations where created_by=uid)>=3 then raise exception 'Pilot organization limit reached'; end if;
 insert into public.organizations(name,created_by,creation_key) values(trim(org_name),uid,request_key) returning id into org_id;
 insert into public.organization_members(organization_id,user_id) values(org_id,uid);
 insert into public.audit_events(organization_id,actor_id,action,entity_id) values(org_id,uid,'organization.created',org_id);
 return org_id;
end $$;
revoke all on function private.create_organization(text,uuid) from public;
grant execute on function private.create_organization(text,uuid) to authenticated;
create function public.create_organization(org_name text, request_key uuid) returns uuid language sql security invoker set search_path='' as $$
 select private.create_organization(org_name,request_key);
$$;
revoke all on function public.create_organization(text,uuid) from public;
grant execute on function public.create_organization(text,uuid) to authenticated;
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;
create policy tenant_read on public.organizations for select to authenticated using (private.is_member(id));
alter table public.organization_members enable row level security;
revoke all on public.organization_members from anon, authenticated;
grant select on public.organization_members to authenticated;
create policy tenant_read on public.organization_members for select to authenticated using (user_id=(select auth.uid()));
alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
grant select on public.customers to authenticated;
create policy tenant_read on public.customers for select to authenticated using (private.is_member(organization_id));
create index customers_org_created_idx on public.customers(organization_id,created_at desc,id);
alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;
grant select on public.suppliers to authenticated;
create policy tenant_read on public.suppliers for select to authenticated using (private.is_member(organization_id));
create index suppliers_org_created_idx on public.suppliers(organization_id,created_at desc,id);
alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select on public.products to authenticated;
create policy tenant_read on public.products for select to authenticated using (private.is_member(organization_id));
create index products_org_created_idx on public.products(organization_id,created_at desc,id);
alter table public.sales enable row level security;
revoke all on public.sales from anon, authenticated;
grant select on public.sales to authenticated;
create policy tenant_read on public.sales for select to authenticated using (private.is_member(organization_id));
create index sales_org_created_idx on public.sales(organization_id,created_at desc,id);
alter table public.sale_items enable row level security;
revoke all on public.sale_items from anon, authenticated;
grant select on public.sale_items to authenticated;
create policy tenant_read on public.sale_items for select to authenticated using (private.is_member(organization_id));
create index sale_items_org_created_idx on public.sale_items(organization_id,created_at desc,id);
alter table public.purchases enable row level security;
revoke all on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;
create policy tenant_read on public.purchases for select to authenticated using (private.is_member(organization_id));
create index purchases_org_created_idx on public.purchases(organization_id,created_at desc,id);
alter table public.purchase_items enable row level security;
revoke all on public.purchase_items from anon, authenticated;
grant select on public.purchase_items to authenticated;
create policy tenant_read on public.purchase_items for select to authenticated using (private.is_member(organization_id));
create index purchase_items_org_created_idx on public.purchase_items(organization_id,created_at desc,id);
alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from anon, authenticated;
grant select on public.inventory_movements to authenticated;
create policy tenant_read on public.inventory_movements for select to authenticated using (private.is_member(organization_id));
create index inventory_movements_org_created_idx on public.inventory_movements(organization_id,created_at desc,id);
alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
create policy tenant_read on public.payments for select to authenticated using (private.is_member(organization_id));
create index payments_org_created_idx on public.payments(organization_id,created_at desc,id);
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant select on public.documents to authenticated;
create policy tenant_read on public.documents for select to authenticated using (private.is_member(organization_id));
create index documents_org_created_idx on public.documents(organization_id,created_at desc,id);
alter table public.document_extractions enable row level security;
revoke all on public.document_extractions from anon, authenticated;
grant select on public.document_extractions to authenticated;
create policy tenant_read on public.document_extractions for select to authenticated using (private.is_member(organization_id));
create index document_extractions_org_created_idx on public.document_extractions(organization_id,created_at desc,id);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
create policy tenant_read on public.audit_events for select to authenticated using (private.is_member(organization_id));
create index audit_events_org_created_idx on public.audit_events(organization_id,created_at desc,id);
grant insert on public.customers to authenticated;
grant update (name,phone,aliases,notes) on public.customers to authenticated;
 create policy tenant_insert on public.customers for insert to authenticated with check(private.is_member(organization_id));
 create policy tenant_update on public.customers for update to authenticated using(private.is_member(organization_id)) with check(private.is_member(organization_id));
 create index customers_org_name_idx on public.customers(organization_id,lower(name));
grant insert on public.suppliers to authenticated;
grant update (name,phone,aliases,notes) on public.suppliers to authenticated;
 create policy tenant_insert on public.suppliers for insert to authenticated with check(private.is_member(organization_id));
 create policy tenant_update on public.suppliers for update to authenticated using(private.is_member(organization_id)) with check(private.is_member(organization_id));
 create index suppliers_org_name_idx on public.suppliers(organization_id,lower(name));
grant insert on public.products to authenticated;
grant update (name,sku,aliases,unit,purchase_price,sale_price,min_stock) on public.products to authenticated;
 create policy tenant_insert on public.products for insert to authenticated with check(private.is_member(organization_id));
 create policy tenant_update on public.products for update to authenticated using(private.is_member(organization_id)) with check(private.is_member(organization_id));
 create index products_org_name_idx on public.products(organization_id,lower(name));
create index inventory_product_idx on public.inventory_movements(organization_id,product_id);
create index sales_customer_idx on public.sales(organization_id,customer_id,status);
create index purchases_supplier_idx on public.purchases(organization_id,supplier_id,status);
create index payments_customer_idx on public.payments(organization_id,customer_id);
create index payments_supplier_idx on public.payments(organization_id,supplier_id);
create index sale_items_sale_idx on public.sale_items(organization_id,sale_id);
create index purchase_items_purchase_idx on public.purchase_items(organization_id,purchase_id);
create index document_extractions_doc_idx on public.document_extractions(organization_id,document_id);
create view public.product_balances with (security_invoker=true) as
 select p.id,p.organization_id,p.created_at,p.name,p.sku,p.aliases,p.unit,p.purchase_price::text,p.sale_price::text,p.min_stock::text,coalesce((select sum(m.qty_delta) from public.inventory_movements m where m.organization_id=p.organization_id and m.product_id=p.id),0)::text as stock from public.products p;
create view public.customer_balances with (security_invoker=true) as
 select c.*,(coalesce((select sum(s.total) from public.sales s where s.organization_id=c.organization_id and s.customer_id=c.id and s.status='posted'),0)
 - coalesce((select sum(p.amount) from public.payments p where p.organization_id=c.organization_id and p.customer_id=c.id),0))::text as balance from public.customers c;
create view public.supplier_balances with (security_invoker=true) as
 select c.*,(coalesce((select sum(s.total) from public.purchases s where s.organization_id=c.organization_id and s.supplier_id=c.id and s.status='posted'),0)
 - coalesce((select sum(p.amount) from public.payments p where p.organization_id=c.organization_id and p.supplier_id=c.id),0))::text as balance from public.suppliers c;
revoke all on public.product_balances,public.customer_balances,public.supplier_balances from anon,authenticated;
grant select on public.product_balances,public.customer_balances,public.supplier_balances to authenticated;
-- Read-only dashboard RPC keeps aggregates in PostgreSQL.
create function public.dashboard_summary(org uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'sold',(select coalesce(sum(total),0) from public.sales where organization_id=org and status='posted' and occurred_at >= (date_trunc('day',now() at time zone 'Asia/Bishkek') at time zone 'Asia/Bishkek') and occurred_at < ((date_trunc('day',now() at time zone 'Asia/Bishkek')+interval '1 day') at time zone 'Asia/Bishkek'))::text,
 'receivable',(select coalesce(sum(greatest(balance::numeric,0)),0)::text from public.customer_balances where organization_id=org),
 'payable',(select coalesce(sum(greatest(balance::numeric,0)),0)::text from public.supplier_balances where organization_id=org),
 'low_stock',(select count(*) from public.product_balances where organization_id=org and stock::numeric<min_stock::numeric),
 'review',(select count(*) from public.documents where organization_id=org and status='review')
 );
$$;
revoke all on function public.dashboard_summary(uuid) from public;
grant execute on function public.dashboard_summary(uuid) to authenticated;

commit;
