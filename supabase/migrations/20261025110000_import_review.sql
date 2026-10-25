-- Загрузка склада из Excel, разбор ошибок (просьба пользователя 25.10.2026):
--   import_products       — только владелец (одна загрузка меняет цены и
--                           остатки всего склада); товар без кода ищется и
--                           по другим названиям, и в архиве (раньше
--                           создавался второй такой же) — из архива
--                           возвращается; остаток может быть меньше нуля;
--                           в ответе — сколько вернули из архива и у каких
--                           товаров сменился код;
--   set_import_categories — только владелец, товар ищется так же.
-- Остаток, как и раньше, ставится как в файле (решение пользователя: это
-- его правка склада). Данные не меняются.
begin;

-- Товар по названию из файла: действующий раньше архивного, точное название
-- раньше другого названия. Нет — null.
create function private.import_product_by_name(p_org uuid, p_name text) returns uuid
language sql stable security definer set search_path='' as $$
  select id from public.products
  where organization_id = p_org and private.product_named(p_name, name, aliases)
  order by (archived_at is null) desc, (lower(name) = lower(p_name)) desc, created_at
  limit 1
$$;
revoke all on function private.import_product_by_name(uuid,text) from public, anon, authenticated;

create or replace function public.import_products(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb; v_i integer := 0; v_created integer := 0; v_updated integer := 0; v_restored integer := 0;
  v_errors jsonb := '[]'; v_recoded jsonb := '[]';
  v_id uuid; v_old record; v_name text; v_sku text; v_unit text; v_stock text; v_delta numeric;
  v_cost text; v_cost_currency text; v_other text;
begin
  perform private.require_member(p_org);
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
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
      -- Остаток бывает в минусе (продали больше, чем было записано).
      if v_stock is not null and v_stock !~ '^-?[0-9]{1,13}(\.[0-9]{1,3})?$' then raise exception 'invalid_qty'; end if;
      if v_sku is not null and length(v_sku) > 80 then raise exception 'invalid_sku'; end if;
      v_id := null;
      if v_sku is not null then
        select * into v_old from public.products where organization_id=p_org and lower(sku)=lower(v_sku)
        order by (archived_at is null) desc, created_at limit 1;
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
        v_id := private.import_product_by_name(p_org, v_name);
        if v_id is not null then
          select * into v_old from public.products where organization_id=p_org and id=v_id;
          -- Код из файла ничей (иначе нашли бы по коду) — товар его получит; прежний — в ответ.
          if v_sku is not null and v_old.sku is not null and lower(v_old.sku) <> lower(v_sku) then
            v_recoded := v_recoded || jsonb_build_object('row', v_i, 'old', v_old.sku);
          end if;
        end if;
      end if;
      if v_id is null then
        insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency)
        values(p_org,v_name,v_sku,coalesce(v_unit,'шт'),
          coalesce(nullif(v_row->>'sale_price',''),'0')::numeric,
          coalesce(v_cost,'0')::numeric,
          case when v_cost is not null then v_cost_currency end)
        returning id into v_id;
        if v_stock is not null and v_stock::numeric <> 0 then
          insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,note)
          values(p_org,v_id,v_stock::numeric,'opening','Импорт');
        end if;
        v_created := v_created + 1;
      else
        if v_old.archived_at is not null then v_restored := v_restored + 1; end if;
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
    jsonb_build_object('created',v_created,'updated',v_updated,'restored',v_restored,
      'recoded',jsonb_array_length(v_recoded),'errors',jsonb_array_length(v_errors)));
  return jsonb_build_object('created',v_created,'updated',v_updated,'restored',v_restored,
    'recoded',v_recoded,'errors',v_errors);
end
$$;
revoke all on function public.import_products(uuid,jsonb) from public, anon;
grant execute on function public.import_products(uuid,jsonb) to authenticated;

-- Категории из Excel: как в optional_product_code.sql, только владелец;
-- без кода товар ищется как в import_products.
create or replace function public.set_import_categories(p_org uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb; v_product uuid; v_sku text; v_name text; v_top uuid; v_cat uuid;
  v_changed integer; v_total integer := 0;
begin
  perform private.require_member(p_org);
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000
  then raise exception 'invalid_input'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    continue when nullif(trim(coalesce(v_row->>'category','')), '') is null;
    v_sku := nullif(trim(coalesce(v_row->>'sku','')), '');
    v_name := regexp_replace(trim(coalesce(v_row->>'name','')), '\s+', ' ', 'g');
    v_product := null;
    if v_sku is not null then
      select id into v_product from public.products
      where organization_id = p_org and lower(sku) = lower(v_sku) and private.product_named(v_name, name, aliases)
      order by (archived_at is null) desc, created_at limit 1;
    end if;
    if v_product is null then v_product := private.import_product_by_name(p_org, v_name); end if;
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
language sql immutable set search_path='' as $$ select '20261025110000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
