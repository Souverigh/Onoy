-- Категории товаров (просьба пользователя 23.10.2026): категория и
-- подкатегория (два уровня), товар без категории — «Без категории».
--   product_categories   — категории магазина; parent_id — у подкатегории;
--   products.category_id — категория товара (пусто — без категории).
-- Сами категории не появляются: приложение предлагает их по названиям
-- товаров, ставит только то, что человек подтвердил нажатием.
--   save_product_category   — создать / переименовать (участник магазина);
--   delete_product_category — удалить (владелец): товары подкатегории
--                             переходят в её категорию, категории — без
--                             категории;
--   set_products_category   — поставить категорию товарам (участник);
--   apply_category_groups   — создать предложенные категории и разложить по
--                             ним товары без категории (участник);
--   set_import_categories   — категории из Excel (по коду или названию, как
--                             import_products);
--   get_catalog             — отдаёт категории для отбора в каталоге.
-- product_balances / product_list пересоздаются с category_id в конце.
-- Новая таблица, новая пустая колонка, функции и представления; данные не
-- меняются.
begin;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  parent_id uuid,
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  unique (organization_id, id),
  foreign key (organization_id, parent_id) references public.product_categories(organization_id, id)
);
-- Одно имя — один раз на уровне (в магазине / внутри категории).
create unique index product_categories_name_idx on public.product_categories
  (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
alter table public.product_categories enable row level security;
revoke all on public.product_categories from anon, authenticated;
grant select on public.product_categories to authenticated;
create policy tenant_read on public.product_categories for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.product_categories
  for each row execute function private.reject_blocked_shop();

alter table public.products add column category_id uuid;
alter table public.products add constraint products_category_fk
  foreign key (organization_id, category_id) references public.product_categories(organization_id, id);
create index products_category_idx on public.products(organization_id, category_id);

-- Имя категории: пробелы схлопнуты, 1–60 символов.
create function private.category_name(p_name text) returns text
language plpgsql immutable set search_path='' as $$
declare v_name text := regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g');
begin
  if length(v_name) not between 1 and 60 then raise exception 'invalid_category'; end if;
  return v_name;
end
$$;

-- Найти категорию по имени (без учёта регистра) или создать. p_parent —
-- категория верхнего уровня этого магазина или null.
create function private.ensure_category(p_org uuid, p_name text, p_parent uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_name text := private.category_name(p_name); v_id uuid;
begin
  if p_parent is not null and not exists(
    select 1 from public.product_categories where organization_id = p_org and id = p_parent and parent_id is null
  ) then raise exception 'invalid_category'; end if;
  select id into v_id from public.product_categories
  where organization_id = p_org and parent_id is not distinct from p_parent and lower(name) = lower(v_name);
  if v_id is null then
    insert into public.product_categories(organization_id, parent_id, name)
    values (p_org, p_parent, v_name)
    returning id into v_id;
  end if;
  return v_id;
end
$$;
revoke all on function private.ensure_category(uuid,text,uuid) from public, anon, authenticated;

-- Создать (p_id null) или переименовать. Подкатегория — только внутри
-- категории верхнего уровня; занятое имя — category_taken.
create function public.save_product_category(p_org uuid, p_id uuid, p_name text, p_parent uuid default null)
returns uuid
language plpgsql security definer set search_path='' as $$
declare v_name text; v_id uuid;
begin
  perform private.require_member(p_org);
  v_name := private.category_name(p_name);
  if p_id is null then
    if p_parent is not null and not exists(
      select 1 from public.product_categories where organization_id = p_org and id = p_parent and parent_id is null
    ) then raise exception 'invalid_category'; end if;
    insert into public.product_categories(organization_id, parent_id, name)
    values (p_org, p_parent, v_name)
    returning id into v_id;
  else
    update public.product_categories set name = v_name
    where organization_id = p_org and id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'invalid_category'; end if;
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), case when p_id is null then 'category.created' else 'category.renamed' end,
    v_id, jsonb_build_object('name', v_name));
  return v_id;
exception when unique_violation then
  raise exception 'category_taken';
end
$$;
revoke all on function public.save_product_category(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.save_product_category(uuid,uuid,text,uuid) to authenticated;

-- Удалить категорию (владелец). Товары не теряются: из подкатегории — в её
-- категорию, из категории (и её подкатегорий) — без категории.
-- Возвращает, у скольких товаров сменилась категория.
create function public.delete_product_category(p_org uuid, p_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_parent uuid; v_name text; v_moved integer;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select parent_id, name into v_parent, v_name from public.product_categories
  where organization_id = p_org and id = p_id
  for update;
  if v_name is null then raise exception 'invalid_category'; end if;
  update public.products set category_id = v_parent
  where organization_id = p_org and category_id in (
    select c.id from public.product_categories c
    where c.organization_id = p_org and (c.id = p_id or c.parent_id = p_id)
  );
  get diagnostics v_moved = row_count;
  delete from public.product_categories
  where organization_id = p_org and (id = p_id or parent_id = p_id);
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), 'category.deleted', p_id, jsonb_build_object('name', v_name, 'moved', v_moved));
  return v_moved;
end
$$;
revoke all on function public.delete_product_category(uuid,uuid) from public, anon;
grant execute on function public.delete_product_category(uuid,uuid) to authenticated;

-- Поставить товарам категорию (null — без категории). Меняются только
-- товары этого магазина, где категория правда другая.
create function public.set_products_category(p_org uuid, p_products uuid[], p_category uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_changed integer;
begin
  perform private.require_member(p_org);
  if p_products is null or cardinality(p_products) not between 1 and 5000 then raise exception 'invalid_category'; end if;
  if p_category is not null and not exists(
    select 1 from public.product_categories where organization_id = p_org and id = p_category
  ) then raise exception 'invalid_category'; end if;
  update public.products set category_id = p_category
  where organization_id = p_org and id = any(p_products) and category_id is distinct from p_category;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org, auth.uid(), 'products.category', p_category, jsonb_build_object('changed', v_changed));
  end if;
  return v_changed;
end
$$;
revoke all on function public.set_products_category(uuid,uuid[],uuid) from public, anon;
grant execute on function public.set_products_category(uuid,uuid[],uuid) to authenticated;

-- Предложенные категории, которые человек отметил: [{name, products: [id]}].
-- Категория с таким именем уже есть — берётся она. Ставится только товарам
-- без категории: выбранное раньше вручную не перезаписывается.
create function public.apply_category_groups(p_org uuid, p_groups jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare v_group jsonb; v_id uuid; v_ids uuid[]; v_changed integer; v_total integer := 0; v_created integer := 0;
begin
  perform private.require_member(p_org);
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 1 and 200
  then raise exception 'invalid_category'; end if;
  for v_group in select * from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_group->'products') is distinct from 'array' or jsonb_array_length(v_group->'products') > 5000
    then raise exception 'invalid_category'; end if;
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_group->'products') x;
    if not exists(
      select 1 from public.product_categories
      where organization_id = p_org and parent_id is null and lower(name) = lower(private.category_name(v_group->>'name'))
    ) then v_created := v_created + 1; end if;
    v_id := private.ensure_category(p_org, v_group->>'name', null);
    update public.products set category_id = v_id
    where organization_id = p_org and id = any(coalesce(v_ids, '{}')) and category_id is null;
    get diagnostics v_changed = row_count;
    v_total := v_total + v_changed;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org, auth.uid(), 'category.groups', jsonb_build_object('created', v_created, 'changed', v_total));
  return v_total;
end
$$;
revoke all on function public.apply_category_groups(uuid,jsonb) from public, anon;
grant execute on function public.apply_category_groups(uuid,jsonb) to authenticated;

-- Категории из Excel: [{sku, name, category, subcategory}]. Товар ищется
-- как в import_products: по коду, иначе по названию среди действующих.
-- Пустая категория в строке — категория товара не меняется. Нет такой
-- категории — создаётся. Возвращает, у скольких товаров сменилась.
create function public.set_import_categories(p_org uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb; v_product uuid; v_sku text; v_name text; v_top uuid; v_cat uuid;
  v_changed integer; v_total integer := 0;
begin
  perform private.require_member(p_org);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000
  then raise exception 'invalid_input'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    continue when nullif(trim(coalesce(v_row->>'category','')), '') is null;
    v_sku := nullif(trim(coalesce(v_row->>'sku','')), '');
    v_name := regexp_replace(trim(coalesce(v_row->>'name','')), '\s+', ' ', 'g');
    v_product := null;
    if v_sku is not null then
      select id into v_product from public.products where organization_id = p_org and lower(sku) = lower(v_sku);
    end if;
    if v_product is null then
      select id into v_product from public.products
      where organization_id = p_org and archived_at is null and lower(name) = lower(v_name);
    end if;
    continue when v_product is null;
    v_top := private.ensure_category(p_org, v_row->>'category', null);
    v_cat := case when nullif(trim(coalesce(v_row->>'subcategory','')), '') is null then v_top
                  else private.ensure_category(p_org, v_row->>'subcategory', v_top) end;
    update public.products set category_id = v_cat
    where organization_id = p_org and id = v_product and category_id is distinct from v_cat;
    get diagnostics v_changed = row_count;
    v_total := v_total + v_changed;
  end loop;
  if v_total > 0 then
    insert into public.audit_events(organization_id,actor_id,action,metadata)
    values(p_org, auth.uid(), 'category.import', jsonb_build_object('changed', v_total));
  end if;
  return v_total;
end
$$;
revoke all on function public.set_import_categories(uuid,jsonb) from public, anon;
grant execute on function public.set_import_categories(uuid,jsonb) to authenticated;

-- Склад: как в purchase_currency.sql, плюс category_id в конце.
drop view public.product_list;

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
      and s.reversed_at is null and s.created_at > now() - interval '90 days')::integer as sold_count,
   p.purchase_currency,
   p.category_id
 from public.products p;

create view public.product_list
with (security_invoker=true) as
  select b.*,
    b.stock::numeric as stock_value,
    (
      select max(m.created_at) from public.inventory_movements m
      join public.purchases pu on pu.organization_id=m.organization_id and pu.id=m.purchase_id
      where m.organization_id=b.organization_id and m.product_id=b.id
        and m.reason='purchase' and pu.reversed_at is null
    ) as last_received_at
  from public.product_balances b;
revoke all on public.product_list from anon, authenticated;
grant select on public.product_list to authenticated;

-- Каталог: как в product_photos.sql, плюс категория товара и список
-- категорий, в которых есть видимые товары (с их верхними категориями).
create or replace function public.get_catalog(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  with shop as (
    select l.organization_id, o.name, o.phone, o.seller_phone, o.currency
    from public.catalog_links l
    join public.organizations o on o.id = l.organization_id
    where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and o.blocked_at is null
  ), visible as (
    select p.* from public.products p, shop
    where p.organization_id = shop.organization_id and p.archived_at is null
      and not p.catalog_hidden and p.sale_price > 0
  )
  select jsonb_build_object(
    'shop_name', shop.name,
    'shop_phone', coalesce(nullif(shop.phone, ''), nullif(shop.seller_phone, ''), ''),
    'currency', coalesce(shop.currency, 'KGS'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'unit', v.unit, 'price', v.sale_price::text,
          'photo', v.photo_path, 'category', v.category_id)
        order by lower(v.name))
      from visible v
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent', c.parent_id) order by lower(c.name))
      from public.product_categories c
      where c.organization_id = shop.organization_id and (
        exists(select 1 from visible v where v.category_id = c.id)
        or exists(select 1 from visible v join public.product_categories s
                  on s.organization_id = c.organization_id and s.id = v.category_id where s.parent_id = c.id)
      )
    ), '[]'::jsonb)
  )
  from shop
$$;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261023100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
