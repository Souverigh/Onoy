-- Кухня, этап 1 (модуль «kitchen», решение пользователя 31.10.2026): меню
-- кафе. Блюдо — не товар склада: своего остатка у него нет, его готовят из
-- продуктов. Состав (техкарта) — продукты склада и сколько их уходит на одну
-- порцию, в единице продукта (150 г риса — 0.150 кг). Себестоимость считает
-- приложение по ценам последней закупки — здесь её нет, чтобы не устаревала.
--
-- Две новые таблицы и две функции. Существующие таблицы и данные не меняются.
begin;

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  unique (organization_id, id),
  name text not null check (length(trim(name)) between 1 and 100),
  price numeric(16,2) not null default 0 check (price >= 0 and price < 1e14),
  -- Своя категория меню («Горячее», «Салаты») — не категории продуктов.
  category text check (category is null or length(trim(category)) between 1 and 60),
  -- Не готовят больше: из меню убрано, история остаётся.
  archived_at timestamptz
);
create unique index dishes_org_name_idx on public.dishes(organization_id, lower(name)) where archived_at is null;
alter table public.dishes enable row level security;
revoke all on public.dishes from anon, authenticated;
grant select on public.dishes to authenticated;
create policy member_read on public.dishes for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.dishes
  for each row execute function private.reject_blocked_shop();

create table public.dish_ingredients (
  organization_id uuid not null references public.organizations(id),
  dish_id uuid not null,
  product_id uuid not null,
  -- На одну порцию, в единице продукта; до 4 знаков: 2 г соли — 0.002 кг.
  qty numeric(13,4) not null check (qty > 0),
  position smallint not null default 0,
  primary key (dish_id, product_id),
  foreign key (organization_id, dish_id) references public.dishes(organization_id, id),
  foreign key (organization_id, product_id) references public.products(organization_id, id)
);
create index dish_ingredients_product_idx on public.dish_ingredients(organization_id, product_id);
alter table public.dish_ingredients enable row level security;
revoke all on public.dish_ingredients from anon, authenticated;
grant select on public.dish_ingredients to authenticated;
create policy member_read on public.dish_ingredients for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.dish_ingredients
  for each row execute function private.reject_blocked_shop();

-- Новое блюдо (p_id null) или правка. p_lines — состав целиком:
-- [{"product_id":"…","qty":"0.15"}]; старый состав заменяется новым.
-- Меню правят все участники магазина, как товары.
create function public.save_dish(
  p_org uuid, p_id uuid, p_name text, p_price text, p_category text, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid := p_id;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_category text := nullif(regexp_replace(trim(coalesce(p_category, '')), '\s+', ' ', 'g'), '');
begin
  perform private.require_member(p_org);
  perform 1 from public.organizations where id = p_org for update;
  if length(v_name) not between 1 and 100 then raise exception 'invalid_name'; end if;
  if coalesce(p_price, '') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_price'; end if;
  if v_category is not null and length(v_category) > 60 then raise exception 'invalid_category'; end if;

  -- Состав: до 60 разных продуктов этого магазина (не объединённых, не в
  -- архиве), количество больше нуля, до 4 знаков после точки.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 60
    or exists(
      select 1 from jsonb_array_elements(p_lines) l
      where jsonb_typeof(l) <> 'object'
        or coalesce(l->>'product_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or case when coalesce(l->>'qty', '') ~ '^[0-9]{1,9}(\.[0-9]{1,4})?$' then (l->>'qty')::numeric <= 0 else true end)
    or (select count(distinct l->>'product_id') from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines)
  then raise exception 'invalid_lines'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_lines) l
    where not exists(
      select 1 from public.products p
      where p.organization_id = p_org and p.id = (l->>'product_id')::uuid
        and p.archived_at is null and p.merged_into_id is null))
  then raise exception 'invalid_product'; end if;

  if exists(select 1 from public.dishes where organization_id = p_org and archived_at is null
      and lower(name) = lower(v_name) and id is distinct from v_id)
  then raise exception 'name_taken'; end if;

  if v_id is null then
    insert into public.dishes(organization_id, name, price, category)
    values (p_org, v_name, p_price::numeric, v_category) returning id into v_id;
  else
    update public.dishes set name = v_name, price = p_price::numeric, category = v_category
    where organization_id = p_org and id = v_id and archived_at is null;
    if not found then raise exception 'invalid_dish'; end if;
    delete from public.dish_ingredients where organization_id = p_org and dish_id = v_id;
  end if;

  insert into public.dish_ingredients(organization_id, dish_id, product_id, qty, position)
  select p_org, v_id, (l->>'product_id')::uuid, (l->>'qty')::numeric, (n - 1)::smallint
  from jsonb_array_elements(p_lines) with ordinality as x(l, n);

  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'dish.saved', v_id, jsonb_build_object(
    'name', v_name, 'price', p_price, 'lines', jsonb_array_length(p_lines), 'new', p_id is null));
  return v_id;
end
$$;
revoke all on function public.save_dish(uuid,uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.save_dish(uuid,uuid,text,text,text,jsonb) to authenticated;

-- Убрать блюдо из меню (в архив) или вернуть. Состав и история остаются.
create function public.set_dish_archived(p_org uuid, p_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
  perform private.require_member(p_org);
  select name into v_name from public.dishes where organization_id = p_org and id = p_id for update;
  if not found then raise exception 'invalid_dish'; end if;
  if not p_archived and exists(select 1 from public.dishes where organization_id = p_org and archived_at is null
      and lower(name) = lower(v_name) and id <> p_id)
  then raise exception 'name_taken'; end if;
  update public.dishes set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where organization_id = p_org and id = p_id;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), case when p_archived then 'dish.archived' else 'dish.restored' end, p_id,
    jsonb_build_object('name', v_name));
end
$$;
revoke all on function public.set_dish_archived(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_dish_archived(uuid,uuid,boolean) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261112100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
