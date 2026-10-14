-- Валюта цены закупки (просьба пользователя 13.10.2026): товар закупают в
-- долларах (рублях), а продают в сомах. Цена продажи — как была, в валюте
-- магазина; у цены закупки теперь своя валюта: null — валюта магазина.
-- Импорт из Excel берёт валюту из колонки файла (в одном прайсе могут быть
-- $, ₽ и сом). Приход по фото накладной пишет цену закупки в валюте
-- накладной (раньше — только если она в валюте магазина), приход товарами —
-- в валюте магазина. Существующие товары не меняются: колонка null.
begin;

alter table public.products
  add column purchase_currency text check (purchase_currency is null or purchase_currency in ('KGS','USD','RUB'));
grant update (purchase_currency) on public.products to authenticated;

-- Валюта цены закупки для записи: валюта магазина — null.
create function private.cost_currency(p_org uuid, p_currency text) returns text
language sql stable security definer set search_path='' as $$
  select nullif(p_currency, (select currency from public.organizations where id=p_org))
$$;
revoke all on function private.cost_currency(uuid,text) from public, anon, authenticated;

-- product_list раскрыла b.* при создании — пересоздаём после вида.
drop view public.product_list;

-- Как в return_items.sql, плюс purchase_currency в конце.
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
   p.purchase_currency
 from public.products p;

-- Как в product_list_sorting.sql.
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

-- Товар: как в warehouse.sql, плюс валюта цены закупки (null — валюта магазина).
drop function public.save_product(uuid,uuid,text,text,text,text,text,text,text[],text);
create function public.save_product(
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
  -- Магазин блокируем: два новых товара подряд не получат один код.
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
  v_sku := coalesce(v_sku, v_old_sku, private.next_product_code(p_org));
  if exists(select 1 from public.products where organization_id=p_org
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

-- Импорт: как в warehouse.sql, плюс purchase_currency у строки (пусто —
-- валюта магазина). Валюта меняется только вместе с ценой закупки.
create or replace function public.import_products(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb; v_i integer := 0; v_created integer := 0; v_updated integer := 0; v_errors jsonb := '[]';
  v_id uuid; v_old record; v_name text; v_sku text; v_unit text; v_stock text; v_delta numeric; v_by_sku boolean;
  v_cost text; v_cost_currency text;
begin
  perform private.require_member(p_org);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000
  then raise exception 'invalid_input'; end if;
  perform 1 from public.organizations where id=p_org for update;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
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
        v_id := v_old.id;
      end if;
      -- Найден по коду — название из файла новое; по названию — своё не трогаем
      -- («цемент м400» в файле не переименует «Цемент М400»).
      v_by_sku := v_id is not null;
      if v_id is null then
        select * into v_old from public.products
        where organization_id=p_org and archived_at is null and lower(name)=lower(v_name);
        v_id := v_old.id;
        -- Найден по названию, но в файле другой код, а он занят — не путаем товары.
        if v_id is not null and v_sku is not null and lower(coalesce(v_old.sku,'')) <> lower(v_sku)
          and exists(select 1 from public.products where organization_id=p_org and lower(sku)=lower(v_sku))
        then raise exception 'sku_taken'; end if;
      end if;
      if v_id is null then
        insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency)
        values(p_org,v_name,coalesce(v_sku,private.next_product_code(p_org)),coalesce(v_unit,'шт'),
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
        if exists(select 1 from public.products where organization_id=p_org and archived_at is null
            and lower(name)=lower(v_name) and id<>v_id)
        then raise exception 'name_taken'; end if;
        update public.products set
          name = case when v_by_sku then v_name else name end,
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
      v_errors := v_errors || jsonb_build_object('row', v_i, 'error',
        case when sqlerrm like 'invalid_%' or sqlerrm in ('name_taken','sku_taken') then sqlerrm else 'invalid_row' end);
    end;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'products.imported',
    jsonb_build_object('created',v_created,'updated',v_updated,'errors',jsonb_array_length(v_errors)));
  return jsonb_build_object('created',v_created,'updated',v_updated,'errors',v_errors);
end
$$;

-- Товар по строке накладной: как в auto_stock.sql, но цена закупки
-- запоминается в валюте накладной (раньше — только в валюте магазина).
create function private.product_for_line(
  p_org uuid, p_name text, p_unit text, p_cost numeric, p_cost_currency text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_name text; v_unit text; v_product uuid; v_existing record;
begin
  v_name := left(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'), 160);
  if v_name = '' then return null; end if;
  select id into v_product from public.products
  where organization_id=p_org and archived_at is null
    and (lower(name)=lower(v_name) or exists(select 1 from unnest(aliases) a where lower(a)=lower(v_name)))
  order by (lower(name)=lower(v_name)) desc, created_at
  limit 1;
  if v_product is null then
    v_unit := case when p_unit = any(private.product_units()) then p_unit else 'шт' end;
    insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency)
    values(p_org,v_name,private.next_product_code(p_org),v_unit,0,greatest(coalesce(p_cost,0),0),
      case when p_cost > 0 then private.cost_currency(p_org, p_cost_currency) end)
    returning id into v_product;
    return v_product;
  end if;
  select name, aliases into v_existing from public.products where organization_id=p_org and id=v_product;
  update public.products set
    purchase_price = case when p_cost > 0 then p_cost else purchase_price end,
    purchase_currency = case when p_cost > 0 then private.cost_currency(p_org, p_cost_currency) else purchase_currency end,
    aliases = case
      when lower(v_name) = lower(v_existing.name)
        or exists(select 1 from unnest(v_existing.aliases) a where lower(a)=lower(v_name))
        or cardinality(v_existing.aliases) >= 20
      then aliases else aliases || v_name end
  where organization_id=p_org and id=v_product;
  return v_product;
end
$$;
revoke all on function private.product_for_line(uuid,text,text,numeric,text) from public, anon, authenticated;

-- Автоприём: как в auto_stock.sql, с новой product_for_line.
create or replace function private.auto_stock_purchase(p_org uuid, p_purchase uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_line record; v_product uuid; v_count integer := 0;
  v_currency text;
begin
  select * into v_purchase from public.purchases
  where organization_id=p_org and id=p_purchase for update;
  if not found or v_purchase.status <> 'posted' or v_purchase.reversed_at is not null
    or v_purchase.stocked_at is not null or v_purchase.document_id is null or v_purchase.is_opening
  then return 0; end if;
  if not exists(select 1 from public.documents
    where organization_id=p_org and id=v_purchase.document_id and status='digitized')
  then return 0; end if;
  if not exists(select 1 from public.document_lines
    where organization_id=p_org and document_id=v_purchase.document_id and qty > 0)
  then return 0; end if;

  -- Цены строк — в валюте накладной: исходная валюта записи или валюта долга.
  v_currency := coalesce(v_purchase.original_currency, private.party_currency(p_org,'suppliers',v_purchase.supplier_id));
  for v_line in
    select * from public.document_lines
    where organization_id=p_org and document_id=v_purchase.document_id and qty > 0
    order by n
  loop
    v_product := private.product_for_line(p_org, v_line.name_raw, v_line.unit, v_line.price, v_currency);
    if v_product is null then continue; end if;
    insert into public.inventory_movements(
      organization_id,product_id,qty_delta,reason,purchase_id,unit_cost,cost_currency,created_by)
    values(p_org,v_product,v_line.qty,'purchase',p_purchase,greatest(v_line.price,0),v_currency,
      coalesce(auth.uid(), v_purchase.created_by));
    v_count := v_count + 1;
  end loop;
  update public.purchases set stocked_at=now() where organization_id=p_org and id=p_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,coalesce(auth.uid(), v_purchase.created_by),'purchase.stocked',p_purchase,
    jsonb_build_object('lines',v_count,'auto',true));
  return v_count;
end
$$;
drop function private.product_for_line(uuid,text,text,numeric,boolean);

-- Ручной приём по накладной: как в auto_stock.sql, цена закупки — в валюте накладной.
create or replace function public.receive_purchase_lines(p_org uuid, p_purchase uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_item jsonb; v_line record; v_product uuid; v_name text; v_unit text;
  v_count integer := 0; v_existing record; v_currency text; v_cost_currency text;
begin
  perform private.require_member(p_org);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200
  then raise exception 'invalid_input'; end if;
  perform 1 from public.organizations where id=p_org for update;
  select * into v_purchase from public.purchases where organization_id=p_org and id=p_purchase for update;
  if not found or v_purchase.reversed_at is not null or v_purchase.document_id is null
  then raise exception 'invalid_purchase'; end if;
  if v_purchase.stocked_at is not null then raise exception 'already_stocked'; end if;
  v_currency := coalesce(v_purchase.original_currency, private.party_currency(p_org,'suppliers',v_purchase.supplier_id));
  v_cost_currency := private.cost_currency(p_org, v_currency);
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_line from public.document_lines
    where organization_id=p_org and document_id=v_purchase.document_id
      and id=case when coalesce(v_item->>'line','') ~ '^[0-9a-f-]{36}$' then (v_item->>'line')::uuid end;
    if not found then raise exception 'invalid_line'; end if;
    if v_line.qty <= 0 then continue; end if;
    v_product := case when coalesce(v_item->>'product','') ~ '^[0-9a-f-]{36}$' then (v_item->>'product')::uuid end;
    if v_product is not null then
      if not exists(select 1 from public.products where organization_id=p_org and id=v_product)
      then raise exception 'invalid_product'; end if;
    else
      v_name := left(regexp_replace(trim(coalesce(nullif(v_item->>'name',''), v_line.name_raw)), '\s+', ' ', 'g'), 160);
      select id into v_product from public.products
      where organization_id=p_org and archived_at is null and lower(name)=lower(v_name);
      if v_product is null then
        v_unit := coalesce(nullif(v_item->>'unit',''), v_line.unit);
        if not (v_unit = any(private.product_units())) then v_unit := 'шт'; end if;
        insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency)
        values(p_org,v_name,private.next_product_code(p_org),v_unit,
          case when coalesce(v_item->>'sale_price','') ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
            then (v_item->>'sale_price')::numeric else 0 end,
          greatest(v_line.price,0),
          case when v_line.price > 0 then v_cost_currency end)
        returning id into v_product;
      end if;
    end if;
    select name, aliases into v_existing from public.products where organization_id=p_org and id=v_product;
    update public.products set
      purchase_price = case when v_line.price > 0 then v_line.price else purchase_price end,
      purchase_currency = case when v_line.price > 0 then v_cost_currency else purchase_currency end,
      aliases = case
        when lower(v_line.name_raw) = lower(v_existing.name)
          or exists(select 1 from unnest(v_existing.aliases) a where lower(a)=lower(v_line.name_raw))
          or cardinality(v_existing.aliases) >= 20
        then aliases else aliases || left(trim(v_line.name_raw),160) end
    where organization_id=p_org and id=v_product;
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,purchase_id,unit_cost,cost_currency)
    values(p_org,v_product,v_line.qty,'purchase',p_purchase,greatest(v_line.price,0),v_currency);
    v_count := v_count + 1;
  end loop;
  update public.purchases set stocked_at=now() where organization_id=p_org and id=p_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.stocked',p_purchase,jsonb_build_object('lines',v_count));
  return v_count;
end
$$;

-- Приход товарами: как в record_date.sql; цены строк — в валюте магазина,
-- поэтому валюта цены закупки сбрасывается на неё.
create or replace function public.commit_purchase_items(
  p_org uuid, p_supplier uuid, p_lines jsonb, p_idempotency_key uuid, p_fx_rate text default null,
  p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_line jsonb; v_product record; v_total numeric := 0; v_amount numeric; v_hash text;
  v_existing uuid; v_existing_hash text; v_purchase uuid; v_shop_currency text; v_party_currency text;
  v_n integer := 0; v_qty numeric; v_price numeric; v_foreign boolean;
begin
  perform private.require_member(p_org);
  if p_idempotency_key is null or p_supplier is null
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 200
  then raise exception 'invalid_purchase'; end if;
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_supplier)
  then raise exception 'invalid_supplier'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'qty','') !~ '^[0-9]{1,13}(\.[0-9]{1,3})?$'
      or coalesce(v_line->>'price','') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      or (v_line->>'qty')::numeric <= 0
      or coalesce(v_line->>'product','') !~ '^[0-9a-f-]{36}$'
    then raise exception 'invalid_line'; end if;
    if not exists(select 1 from public.products where organization_id=p_org and id=(v_line->>'product')::uuid)
    then raise exception 'invalid_product'; end if;
    v_total := v_total + round((v_line->>'qty')::numeric * (v_line->>'price')::numeric, 2);
  end loop;
  if v_total <= 0 or v_total >= 100000000000000 then raise exception 'invalid_purchase'; end if;

  select currency into v_shop_currency from public.organizations where id=p_org;
  v_party_currency := private.party_currency(p_org,'suppliers',p_supplier);
  v_foreign := v_party_currency is distinct from v_shop_currency;
  if v_foreign then
    v_amount := private.converted_amount(v_party_currency, v_total::text, v_shop_currency, p_fx_rate);
  else
    v_amount := v_total;
  end if;

  v_hash := md5((jsonb_build_object(
    'supplier_id',p_supplier,'lines',p_lines,
    'fx_rate',case when v_foreign then trim_scale(p_fx_rate::numeric)::text end)
    || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.purchases where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  insert into public.purchases(
    organization_id,supplier_id,status,total,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate,stocked_at,occurred_at
  ) values(p_org,p_supplier,'posted',v_amount,p_idempotency_key,v_hash,
    case when v_foreign then v_total end,
    case when v_foreign then v_shop_currency end,
    case when v_foreign then p_fx_rate::numeric end,
    now(),
    coalesce(p_occurred_at, now()))
  returning id into v_purchase;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_qty := (v_line->>'qty')::numeric;
    v_price := (v_line->>'price')::numeric;
    select id,name,unit into v_product from public.products
    where organization_id=p_org and id=(v_line->>'product')::uuid;
    insert into public.purchase_items(organization_id,purchase_id,product_id,name_snapshot,unit,n,qty,price)
    values(p_org,v_purchase,v_product.id,v_product.name,v_product.unit,v_n,v_qty,v_price);
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,purchase_id,unit_cost,cost_currency)
    values(p_org,v_product.id,v_qty,'purchase',v_purchase,v_price,v_shop_currency);
    if v_price > 0 then
      update public.products set purchase_price=v_price, purchase_currency=null where organization_id=p_org and id=v_product.id;
    end if;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,
    jsonb_build_object('total',v_amount::text,'lines',v_n));
  return v_purchase;
end
$$;

commit;
