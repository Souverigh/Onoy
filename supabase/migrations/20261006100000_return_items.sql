-- Возврат товара по строкам (этап 2, просьба пользователя 06.10.2026): что
-- именно вернул клиент и из какой продажи. Сумма считается в базе по цене, по
-- которой клиент купил; вернуть больше, чем брал (за вычетом прошлых
-- возвратов), нельзя; товар со склада возвращается в остаток. Отмена записи
-- возврата (reverse_payment / undo_recent) убирает его и из остатка — вид
-- не считает отменённые возвраты. Новая таблица, функция и пересоздание вида
-- product_balances — существующие данные не меняются.
begin;

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  unique(organization_id,id),
  -- Запись возврата в payments (kind='return') — она и уменьшает долг.
  payment_id uuid not null,
  sale_id uuid not null,
  -- Строка продажи со склада или распознанная строка фото накладной.
  sale_item_id uuid,
  document_line_id uuid,
  -- Товар склада (только у строк со склада) — в остаток.
  product_id uuid,
  name_snapshot text not null check (length(trim(name_snapshot)) between 1 and 200),
  qty numeric(16,3) not null check (qty > 0 and qty < 1e13),
  -- Цена за единицу в валюте долга клиента.
  price numeric(16,2) not null check (price >= 0 and price < 1e14),
  foreign key (organization_id,payment_id) references public.payments(organization_id,id),
  foreign key (organization_id,sale_id) references public.sales(organization_id,id),
  foreign key (organization_id,sale_item_id) references public.sale_items(organization_id,id),
  foreign key (document_line_id) references public.document_lines(id),
  foreign key (organization_id,product_id) references public.products(organization_id,id),
  check ((sale_item_id is null) <> (document_line_id is null))
);
create index return_items_payment_idx on public.return_items(organization_id, payment_id);
create index return_items_sale_item_idx on public.return_items(organization_id, sale_item_id) where sale_item_id is not null;
create index return_items_document_line_idx on public.return_items(organization_id, document_line_id) where document_line_id is not null;
create index return_items_product_idx on public.return_items(organization_id, product_id) where product_id is not null;
alter table public.return_items enable row level security;
revoke all on public.return_items from anon, authenticated;
grant select on public.return_items to authenticated;
create policy tenant_read on public.return_items for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.return_items
  for each row execute function private.reject_blocked_shop();

-- Сколько уже вернули по строке — без отменённых возвратов.
create function private.returned_qty(p_org uuid, p_sale_item uuid, p_document_line uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(r.qty),0) from public.return_items r
  join public.payments p on p.organization_id=r.organization_id and p.id=r.payment_id
  where r.organization_id=p_org and p.reversed_at is null
    and ((p_sale_item is not null and r.sale_item_id=p_sale_item)
      or (p_document_line is not null and r.document_line_id=p_document_line))
$$;
revoke all on function private.returned_qty(uuid,uuid,uuid) from public, anon, authenticated;

-- Возврат клиента строками: p_lines — [{"sale_item": uuid} или
-- {"document_line": uuid}, "qty": "2"]. Только владелец (как скидка и
-- возврат суммой). Больше долга нельзя — возвратом аванс не делается.
create function public.commit_return(
  p_org uuid, p_customer uuid, p_lines jsonb, p_note text, p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_id uuid;
  v_line jsonb; v_qty numeric; v_row record; v_price numeric; v_amount numeric := 0;
  v_balance numeric; v_rows jsonb := '[]'::jsonb; v_keys text[] := '{}'; v_key text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_customer is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200
  then raise exception 'invalid_return'; end if;
  if length(trim(coalesce(p_note,''))) = 0 or length(p_note) > 500 then raise exception 'invalid_note'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;

  v_hash := md5(jsonb_build_object('customer',p_customer,'lines',p_lines,'note',trim(p_note))::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_party'; end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'qty','') !~ '^[0-9]{1,13}(\.[0-9]{1,3})?$' then raise exception 'invalid_line'; end if;
    v_qty := (v_line->>'qty')::numeric;
    if v_qty <= 0 then raise exception 'invalid_line'; end if;
    v_key := coalesce('i:'||(v_line->>'sale_item'), 'd:'||(v_line->>'document_line'), '');
    if v_key = '' or v_key = any(v_keys) then raise exception 'invalid_line'; end if;
    v_keys := v_keys || v_key;
    -- Строка — только из действующей продажи этого клиента.
    if v_line ? 'sale_item' then
      select i.id as sale_item_id, null::uuid as document_line_id, i.product_id, i.name_snapshot as name,
        i.qty, i.price, s.id as sale_id, s.total, s.original_amount
      into v_row
      from public.sale_items i
      join public.sales s on s.organization_id=i.organization_id and s.id=i.sale_id
      where i.organization_id=p_org and i.id=(v_line->>'sale_item')::uuid and s.customer_id=p_customer
        and s.status='posted' and s.reversed_at is null and not s.is_opening;
    else
      select null::uuid as sale_item_id, l.id as document_line_id, null::uuid as product_id, l.name_raw as name,
        l.qty, l.price, s.id as sale_id, s.total, s.original_amount
      into v_row
      from public.document_lines l
      join public.sales s on s.organization_id=l.organization_id and s.document_id=l.document_id
      where l.organization_id=p_org and l.id=(v_line->>'document_line')::uuid and s.customer_id=p_customer
        and s.status='posted' and s.reversed_at is null and not s.is_opening
        and not exists(select 1 from public.sale_items i where i.organization_id=s.organization_id and i.sale_id=s.id);
    end if;
    if not found then raise exception 'invalid_line'; end if;
    if v_qty + private.returned_qty(p_org, v_row.sale_item_id, v_row.document_line_id) > v_row.qty
    then raise exception 'return_over_qty'; end if;
    -- Продажа в другой валюте: строки в её валюте, долг — total; цена по её курсу.
    v_price := round(v_row.price * case when coalesce(v_row.original_amount,0) > 0
      then v_row.total / v_row.original_amount else 1 end, 2);
    v_amount := v_amount + round(v_qty * v_price, 2);
    v_rows := v_rows || jsonb_build_object(
      'sale_id', v_row.sale_id, 'sale_item_id', v_row.sale_item_id, 'document_line_id', v_row.document_line_id,
      'product_id', v_row.product_id, 'name', left(v_row.name, 200), 'qty', v_qty, 'price', v_price);
  end loop;

  if v_amount <= 0 or v_amount >= 100000000000000 then raise exception 'invalid_return'; end if;
  select balance::numeric into v_balance from public.customer_balances
  where organization_id=p_org and id=p_customer;
  if v_amount - greatest(coalesce(v_balance,0),0) > 0.005 then raise exception 'over_debt'; end if;

  insert into public.payments(
    organization_id,customer_id,direction,amount,status,kind,note,idempotency_key,request_hash
  ) values(
    p_org,p_customer,'incoming',v_amount,'confirmed','return',trim(p_note),p_idempotency_key,v_hash
  ) returning id into v_id;
  insert into public.return_items(organization_id,payment_id,sale_id,sale_item_id,document_line_id,product_id,name_snapshot,qty,price)
  select p_org, v_id, (r->>'sale_id')::uuid, (r->>'sale_item_id')::uuid, (r->>'document_line_id')::uuid,
    (r->>'product_id')::uuid, r->>'name', (r->>'qty')::numeric, (r->>'price')::numeric
  from jsonb_array_elements(v_rows) r;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'adjustment.return',v_id,
    jsonb_build_object('amount',v_amount::text,'direction','incoming','note',left(trim(p_note),500),
      'lines',jsonb_array_length(v_rows)));
  return v_id;
end
$$;
revoke all on function public.commit_return(uuid,uuid,jsonb,text,uuid) from public, anon;
grant execute on function public.commit_return(uuid,uuid,jsonb,text,uuid) to authenticated;

-- Остаток с возвратами: товар, вернувшийся по действующему возврату из
-- действующей продажи (отменённая продажа и так вернула остаток).
create or replace function private.product_stock(p_org uuid, p_product uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce((
    select sum(m.qty_delta) from public.inventory_movements m
    left join public.sales s on s.organization_id=m.organization_id and s.id=m.sale_id
    left join public.purchases pu on pu.organization_id=m.organization_id and pu.id=m.purchase_id
    where m.organization_id=p_org and m.product_id=p_product
      and s.reversed_at is null and pu.reversed_at is null
  ),0) + coalesce((
    select sum(r.qty) from public.return_items r
    join public.payments p on p.organization_id=r.organization_id and p.id=r.payment_id
    join public.sales s on s.organization_id=r.organization_id and s.id=r.sale_id
    where r.organization_id=p_org and r.product_id=p_product
      and p.reversed_at is null and s.reversed_at is null
  ),0)
$$;
revoke all on function private.product_stock(uuid,uuid) from public, anon, authenticated;

create or replace view public.product_balances with (security_invoker=true) as
 select p.id,p.organization_id,p.created_at,p.name,p.sku,p.aliases,p.unit,
   p.purchase_price::text,p.sale_price::text,p.min_stock::text,
   (coalesce((
     select sum(m.qty_delta) from public.inventory_movements m
     left join public.sales s on s.organization_id=m.organization_id and s.id=m.sale_id
     left join public.purchases pu on pu.organization_id=m.organization_id and pu.id=m.purchase_id
     where m.organization_id=p.organization_id and m.product_id=p.id
       and s.reversed_at is null and pu.reversed_at is null
   ),0) + coalesce((
     select sum(r.qty) from public.return_items r
     join public.payments pay on pay.organization_id=r.organization_id and pay.id=r.payment_id
     join public.sales s on s.organization_id=r.organization_id and s.id=r.sale_id
     where r.organization_id=p.organization_id and r.product_id=p.id
       and pay.reversed_at is null and s.reversed_at is null
   ),0))::text as stock,
   p.archived_at,
   (select count(*) from public.sale_items i
    join public.sales s on s.organization_id=i.organization_id and s.id=i.sale_id
    where i.organization_id=p.organization_id and i.product_id=p.id
      and s.reversed_at is null and s.created_at > now() - interval '90 days')::integer as sold_count
 from public.products p;

commit;
