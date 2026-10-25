-- Код товара необязателен (просьба пользователя 25.10.2026). Раньше товару
-- без кода база сама ставила следующий номер (1, 2, 3…), в том числе прямо во
-- время импорта из Excel. Ниже в том же файле шли товары дилера с такими же
-- кодами — импорт находил по коду уже записанный товар и переписывал его
-- название («Прожектор BILLOW 100W» стал «FELIX БЕЛЫЙ»).
--   next_product_code     — больше не придумывает код: новый товар без кода
--                           остаётся без кода (форма, импорт, накладные);
--   save_product          — код можно стереть в форме товара;
--   import_products       — товар по коду находится, только если название
--                           то же (или одно из его других названий); код
--                           есть у товара с другим названием — строка не
--                           загружается, в ошибке — чей это код;
--   set_import_categories — категория из файла ищет товар по тому же правилу.
-- Данные не меняются: уже поставленные коды остаются у товаров.
begin;

-- Все места, где товар создаётся без кода, звали эту функцию; теперь код пустой.
create or replace function private.next_product_code(p_org uuid) returns text
language sql stable security definer set search_path='' as $$
  select null::text
$$;
revoke all on function private.next_product_code(uuid) from public, anon, authenticated;

-- Тот же товар: название совпало без учёта регистра или есть среди других названий.
create function private.product_named(p_name text, p_product_name text, p_aliases text[]) returns boolean
language sql immutable set search_path='' as $$
  select lower(p_name) = lower(p_product_name)
    or exists(select 1 from unnest(coalesce(p_aliases, '{}')) a where lower(a) = lower(p_name))
$$;
revoke all on function private.product_named(text,text,text[]) from public, anon, authenticated;

-- Товар из формы: как в purchase_currency.sql, но код не придумывается, а
-- стёртый в форме код убирается (раньше оставался прежний).
create or replace function public.save_product(
  p_org uuid, p_id uuid, p_name text, p_sku text, p_unit text,
  p_sale_price text, p_purchase_price text default '0', p_min_stock text default '0',
  p_aliases text[] default null, p_opening_stock text default null, p_purchase_currency text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_old_sku text; v_old_aliases text[]; v_old_price numeric;
  v_name text := regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_sku text := nullif(trim(coalesce(p_sku,'')), '');
  v_aliases text[];
  v_cost_currency text;
begin
  perform private.require_member(p_org);
  perform 1 from public.organizations where id=p_org for update;
  if length(v_name) not between 1 and 160 then raise exception 'invalid_name'; end if;
  if p_unit is null or not (p_unit = any(private.product_units())) then raise exception 'invalid_unit'; end if;
  if coalesce(p_sale_price,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or coalesce(p_purchase_price,'0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_price'; end if;
  if p_purchase_currency is not null and p_purchase_currency not in ('KGS','USD','RUB')
  then raise exception 'invalid_currency'; end if;
  v_cost_currency := private.cost_currency(p_org, p_purchase_currency);
  if coalesce(p_min_stock,'0') !~ '^[0-9]{1,13}(\.[0-9]{1,3})?$'
    or (p_opening_stock is not null and p_opening_stock !~ '^[0-9]{1,13}(\.[0-9]{1,3})?$')
  then raise exception 'invalid_qty'; end if;
  if v_sku is not null and length(v_sku) > 80 then raise exception 'invalid_sku'; end if;
  if p_id is not null then
    select sku, aliases, sale_price into v_old_sku, v_old_aliases, v_old_price
    from public.products where organization_id=p_org and id=p_id for update;
    if not found then raise exception 'invalid_product'; end if;
  end if;
  if exists(select 1 from public.products where organization_id=p_org and archived_at is null
      and lower(name)=lower(v_name) and id is distinct from p_id)
  then raise exception 'name_taken'; end if;
  -- null — код не трогаем (как был), пустая строка — код стёрли в форме.
  if p_sku is null then v_sku := v_old_sku; end if;
  if v_sku is not null and exists(select 1 from public.products where organization_id=p_org
      and lower(sku)=lower(v_sku) and id is distinct from p_id)
  then raise exception 'sku_taken'; end if;
  select coalesce(array_agg(distinct a), '{}') into v_aliases from (
    select left(regexp_replace(trim(x), '\s+', ' ', 'g'), 160) as a
    from unnest(coalesce(p_aliases, v_old_aliases, '{}')) as x
  ) t where a <> '' and lower(a) <> lower(v_name);
  if cardinality(v_aliases) > 20 then raise exception 'invalid_aliases'; end if;

  if p_id is null then
    insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency,min_stock,aliases)
    values(p_org,v_name,v_sku,p_unit,p_sale_price::numeric,coalesce(p_purchase_price,'0')::numeric,v_cost_currency,
      coalesce(p_min_stock,'0')::numeric,v_aliases)
    returning id into v_id;
    if p_opening_stock is not null and p_opening_stock::numeric > 0 then
      insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,note)
      values(p_org,v_id,p_opening_stock::numeric,'opening','Начальный остаток');
    end if;
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'product.created',v_id,jsonb_build_object('name',v_name));
  else
    update public.products set name=v_name, sku=v_sku, unit=p_unit, sale_price=p_sale_price::numeric,
      purchase_price=coalesce(p_purchase_price,'0')::numeric, purchase_currency=v_cost_currency,
      min_stock=coalesce(p_min_stock,'0')::numeric, aliases=v_aliases
    where organization_id=p_org and id=p_id;
    v_id := p_id;
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'product.updated',v_id,jsonb_build_object('name',v_name,
      'sale_price',p_sale_price,'old_sale_price',v_old_price::text));
  end if;
  return v_id;
end
$$;
revoke all on function public.save_product(uuid,uuid,text,text,text,text,text,text,text[],text,text) from public,anon;
grant execute on function public.save_product(uuid,uuid,text,text,text,text,text,text,text[],text,text) to authenticated;

-- Импорт: как в purchase_currency.sql, но код не придумывается, а товар по
-- коду с другим названием не переписывается — ошибка 'sku_other' с его названием.
create or replace function public.import_products(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb; v_i integer := 0; v_created integer := 0; v_updated integer := 0; v_errors jsonb := '[]';
  v_id uuid; v_old record; v_name text; v_sku text; v_unit text; v_stock text; v_delta numeric;
  v_cost text; v_cost_currency text; v_other text;
begin
  perform private.require_member(p_org);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000
  then raise exception 'invalid_input'; end if;
  perform 1 from public.organizations where id=p_org for update;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_other := null;
    begin
      v_name := regexp_replace(trim(coalesce(v_row->>'name','')), '\s+', ' ', 'g');
      v_sku := nullif(trim(coalesce(v_row->>'sku','')), '');
      v_unit := nullif(v_row->>'unit','');
      v_stock := nullif(v_row->>'stock','');
      v_cost := nullif(v_row->>'purchase_price','');
      v_cost_currency := nullif(v_row->>'purchase_currency','');
      if length(v_name) not between 1 and 160 then raise exception 'invalid_name'; end if;
      if v_unit is not null and not (v_unit = any(private.product_units())) then raise exception 'invalid_unit'; end if;
      if coalesce(v_row->>'sale_price','0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
        or coalesce(v_row->>'purchase_price','0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception 'invalid_price'; end if;
      if v_cost_currency is not null and v_cost_currency not in ('KGS','USD','RUB')
      then raise exception 'invalid_currency'; end if;
      v_cost_currency := private.cost_currency(p_org, v_cost_currency);
      if v_stock is not null and v_stock !~ '^[0-9]{1,13}(\.[0-9]{1,3})?$' then raise exception 'invalid_qty'; end if;
      if v_sku is not null and length(v_sku) > 80 then raise exception 'invalid_sku'; end if;
      v_id := null;
      if v_sku is not null then
        select * into v_old from public.products where organization_id=p_org and lower(sku)=lower(v_sku);
        if found then
          -- Код тот же, а товар другой — не переписываем его, строку не грузим.
          if not private.product_named(v_name, v_old.name, v_old.aliases) then
            v_other := v_old.name;
            raise exception 'sku_other';
          end if;
          v_id := v_old.id;
        end if;
      end if;
      if v_id is null then
        -- Своё название не трогаем: «цемент м400» в файле не переименует «Цемент М400».
        select * into v_old from public.products
        where organization_id=p_org and archived_at is null and lower(name)=lower(v_name);
        -- Код из файла здесь ничей (иначе нашли бы по коду) — товар его получит.
        v_id := v_old.id;
      end if;
      if v_id is null then
        insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency)
        values(p_org,v_name,v_sku,coalesce(v_unit,'шт'),
          coalesce(nullif(v_row->>'sale_price',''),'0')::numeric,
          coalesce(v_cost,'0')::numeric,
          case when v_cost is not null then v_cost_currency end)
        returning id into v_id;
        if v_stock is not null and v_stock::numeric > 0 then
          insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,note)
          values(p_org,v_id,v_stock::numeric,'opening','Импорт');
        end if;
        v_created := v_created + 1;
      else
        update public.products set
          sku = coalesce(v_sku, sku),
          unit = coalesce(v_unit, unit),
          sale_price = coalesce(nullif(v_row->>'sale_price','')::numeric, sale_price),
          purchase_price = coalesce(v_cost::numeric, purchase_price),
          purchase_currency = case when v_cost is not null then v_cost_currency else purchase_currency end,
          archived_at = null
        where organization_id=p_org and id=v_id;
        if v_stock is not null then
          v_delta := v_stock::numeric - private.product_stock(p_org, v_id);
          if v_delta <> 0 then
            insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,note)
            values(p_org,v_id,v_delta,'adjustment','Импорт');
          end if;
        end if;
        v_updated := v_updated + 1;
      end if;
    exception when others then
      if sqlerrm = 'shop_blocked' then raise; end if;
      v_errors := v_errors || jsonb_strip_nulls(jsonb_build_object('row', v_i, 'error',
        case when sqlerrm like 'invalid_%' or sqlerrm in ('name_taken','sku_taken','sku_other') then sqlerrm
          -- Два товара с одним кодом (уникальность в базе) — тоже «код у другого товара».
          when sqlstate = '23505' then 'sku_taken' else 'invalid_row' end,
        'other', v_other));
    end;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'products.imported',
    jsonb_build_object('created',v_created,'updated',v_updated,'errors',jsonb_array_length(v_errors)));
  return jsonb_build_object('created',v_created,'updated',v_updated,'errors',v_errors);
end
$$;
revoke all on function public.import_products(uuid,jsonb) from public, anon;
grant execute on function public.import_products(uuid,jsonb) to authenticated;

-- Категории из Excel: как в product_categories.sql, товар по коду — только
-- с тем же названием, иначе — по названию (как в import_products).
create or replace function public.set_import_categories(p_org uuid, p_rows jsonb) returns integer
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
      select id into v_product from public.products
      where organization_id = p_org and lower(sku) = lower(v_sku) and private.product_named(v_name, name, aliases);
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

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261025100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
