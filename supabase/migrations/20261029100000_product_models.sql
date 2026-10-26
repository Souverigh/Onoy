-- Размеры и цвета (модуль «variants», src/lib/business.ts; решение
-- пользователя 25.10.2026). Каждый размер и цвет — обычный товар со своим
-- остатком, ценой и кодом: «Футболка Nike (M, Чёрный)». Продажа, приход,
-- накладные, каталог и остатки работают с ними как с любым товаром — эти
-- функции не меняются. Модель (product_models) только объединяет такие
-- товары и помнит, какие размеры и цвета у неё есть.
--
-- Новая таблица, две пустые колонки у товаров (без default — строки не
-- переписываются, у всех существующих товаров null) и одна функция.
-- Существующие товары, остатки и записи не меняются.
begin;

create table public.product_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  unique (organization_id, id),
  name text not null check (length(trim(name)) between 1 and 100),
  -- Оси по порядку: [{"key":"size","values":["S","M"]},{"key":"color","values":["Чёрный"]}].
  axes jsonb not null check (jsonb_typeof(axes) = 'array' and jsonb_array_length(axes) between 1 and 3)
);
create index product_models_org_idx on public.product_models(organization_id, lower(name));
alter table public.product_models enable row level security;
revoke all on public.product_models from anon, authenticated;
grant select on public.product_models to authenticated;
create policy member_read on public.product_models for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.product_models
  for each row execute function private.reject_blocked_shop();

alter table public.products
  add column model_id uuid,
  -- {"size":"M","color":"Чёрный"} — какой это размер и цвет модели.
  add column variant_attrs jsonb check (variant_attrs is null or jsonb_typeof(variant_attrs) = 'object');
alter table public.products add constraint products_model_fk
  foreign key (organization_id, model_id) references public.product_models(organization_id, id);
create index products_model_idx on public.products(organization_id, model_id) where model_id is not null;

-- Новая модель или новые размеры/цвета к ней. p_axes — оси с вариантами
-- (как в product_models.axes); p_rows — какие сочетания создать и сколько
-- их есть: [{"attrs":{"size":"M","color":"Чёрный"},"qty":"3"}]. Сочетание,
-- которое у модели уже есть (и в архиве), пропускается — товар не
-- задваивается. p_apply_prices — у существующей модели поставить цены всем
-- её товарам (кнопка «Цена для всех размеров»).
create function public.save_product_model(
  p_org uuid, p_model uuid, p_name text, p_axes jsonb, p_rows jsonb,
  p_sale_price text, p_purchase_price text default '0', p_purchase_currency text default null,
  p_apply_prices boolean default false
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_model uuid := p_model;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_keys text[];
  v_cost_currency text;
  v_row jsonb;
  v_attrs jsonb;
  v_product uuid;
  v_product_name text;
  v_qty numeric;
  v_created integer := 0;
  v_updated integer := 0;
begin
  perform private.require_member(p_org);
  perform 1 from public.organizations where id = p_org for update;
  if coalesce(p_sale_price, '') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or coalesce(p_purchase_price, '0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_price'; end if;
  if p_purchase_currency is not null and p_purchase_currency not in ('KGS','USD','RUB')
  then raise exception 'invalid_currency'; end if;
  v_cost_currency := private.cost_currency(p_org, p_purchase_currency);

  -- Оси: 1–3, ключ латиницей, у каждой 1–40 разных вариантов до 30 знаков.
  if p_axes is null or jsonb_typeof(p_axes) <> 'array' or jsonb_array_length(p_axes) not between 1 and 3
    or exists(
      select 1 from jsonb_array_elements(p_axes) a
      where jsonb_typeof(a) <> 'object'
        or coalesce(a->>'key', '') !~ '^[a-z]{1,20}$'
        or jsonb_typeof(a->'values') is distinct from 'array'
        or jsonb_array_length(a->'values') not between 1 and 40
        or exists(
          select 1 from jsonb_array_elements(a->'values') v
          where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 30
            or v #>> '{}' <> regexp_replace(trim(v #>> '{}'), '\s+', ' ', 'g'))
        or (select count(distinct lower(v)) from jsonb_array_elements_text(a->'values') v) <> jsonb_array_length(a->'values')
    )
  then raise exception 'invalid_axes'; end if;
  select array_agg(a->>'key' order by n) into v_keys from jsonb_array_elements(p_axes) with ordinality as x(a, n);
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'invalid_axes'; end if;

  -- Строки: только оси модели, значения из их списков, количество ≥ 0.
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300
    or exists(
      select 1 from jsonb_array_elements(p_rows) r
      where jsonb_typeof(r) <> 'object' or jsonb_typeof(r->'attrs') is distinct from 'object'
        or (select array_agg(k order by k) from jsonb_object_keys(r->'attrs') k)
           is distinct from (select array_agg(k order by k) from unnest(v_keys) k)
        or exists(
          select 1 from jsonb_array_elements(p_axes) a
          where not ((a->'values') @> jsonb_build_array(r->'attrs'->(a->>'key'))))
        or case when coalesce(r->>'qty', '0') ~ '^[0-9]{1,13}(\.[0-9]{1,3})?$' then false else true end
    )
    or (select count(distinct r->'attrs') from jsonb_array_elements(p_rows) r) <> jsonb_array_length(p_rows)
  then raise exception 'invalid_variants'; end if;

  if v_model is null then
    if length(v_name) not between 1 and 100 then raise exception 'invalid_name'; end if;
    if jsonb_array_length(p_rows) = 0 then raise exception 'invalid_variants'; end if;
    insert into public.product_models(organization_id, name, axes)
    values (p_org, v_name, p_axes) returning id into v_model;
  else
    -- Название модели не меняется: по нему названы её товары.
    select name into v_name from public.product_models where organization_id = p_org and id = v_model for update;
    if not found then raise exception 'invalid_model'; end if;
    update public.product_models set axes = p_axes where organization_id = p_org and id = v_model;
  end if;

  for v_row in select r from jsonb_array_elements(p_rows) r loop
    v_attrs := v_row->'attrs';
    continue when exists(
      select 1 from public.products where organization_id = p_org and model_id = v_model and variant_attrs = v_attrs);
    v_product_name := v_name || ' (' || (
      select string_agg(v_attrs->>k, ', ' order by n) from unnest(v_keys) with ordinality as x(k, n)) || ')';
    if length(v_product_name) > 160 then raise exception 'invalid_name'; end if;
    if exists(select 1 from public.products where organization_id = p_org and archived_at is null
        and lower(name) = lower(v_product_name))
    then raise exception 'name_taken'; end if;
    insert into public.products(organization_id, name, unit, sale_price, purchase_price, purchase_currency, model_id, variant_attrs)
    values (p_org, v_product_name, 'шт', p_sale_price::numeric, coalesce(p_purchase_price, '0')::numeric,
      v_cost_currency, v_model, v_attrs)
    returning id into v_product;
    v_qty := coalesce(v_row->>'qty', '0')::numeric;
    if v_qty > 0 then
      insert into public.inventory_movements(organization_id, product_id, qty_delta, reason, note)
      values (p_org, v_product, v_qty, 'opening', 'Начальный остаток');
    end if;
    insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
    values (p_org, auth.uid(), 'product.created', v_product, jsonb_build_object('name', v_product_name, 'model', v_model));
    v_created := v_created + 1;
  end loop;

  if p_model is not null and p_apply_prices then
    update public.products
    set sale_price = p_sale_price::numeric, purchase_price = coalesce(p_purchase_price, '0')::numeric,
        purchase_currency = v_cost_currency
    where organization_id = p_org and model_id = v_model and archived_at is null;
    get diagnostics v_updated = row_count;
  end if;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'product_model.saved', v_model, jsonb_build_object(
    'name', v_name, 'created', v_created, 'prices_set', v_updated,
    'sale_price', case when p_apply_prices then p_sale_price end));
  return v_model;
end
$$;
revoke all on function public.save_product_model(uuid,uuid,text,jsonb,jsonb,text,text,text,boolean) from public, anon;
grant execute on function public.save_product_model(uuid,uuid,text,jsonb,jsonb,text,text,text,boolean) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261029100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
