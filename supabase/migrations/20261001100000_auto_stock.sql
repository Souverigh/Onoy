-- Приход товара сам попадает на склад (просьба пользователя 01.10.2026).
-- 1) Накладная прихода по фото: как только её строки сверены (распознавание
--    сошлось с итогом или пользователь подтвердил «Расхождение»), строки
--    добавляются в остаток — без кнопки «Принять на склад». Товар ищется по
--    названию и синонимам; нет такого — заводится новый.
-- 2) Приход товарами без фото (commit_purchase_items): поставщик, строки
--    «товар — количество — цена закупки» → долг поставщику на сумму строк,
--    строки в purchase_items, остаток и закупочная цена товара.
-- 3) У движения склада теперь есть цена за единицу и её валюта — основа для
--    себестоимости и стоимости склада.
-- Старые приходы не трогаем: несверенные и уже сверенные до этой миграции
-- принимаются, как раньше, кнопкой на странице накладной.
begin;

alter table public.inventory_movements
  add column unit_cost numeric(16,2) check (unit_cost is null or (unit_cost >= 0 and unit_cost < 1e14)),
  add column cost_currency text check (cost_currency is null or cost_currency in ('KGS','USD','RUB'));

-- Строка прихода без фото: единица на момент прихода и порядок строк (как у sale_items).
alter table public.purchase_items
  add column unit text,
  add column n integer check (n is null or n > 0);
create trigger reject_blocked_shop before insert or update on public.purchase_items
  for each row execute function private.reject_blocked_shop();

-- Товар по названию со строки накладной: точное имя или синоним; нет — новый
-- (код — следующий номер). Название строки запоминается синонимом.
create function private.product_for_line(
  p_org uuid, p_name text, p_unit text, p_cost numeric, p_cost_is_shop boolean
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
    insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price)
    values(p_org,v_name,private.next_product_code(p_org),v_unit,0,
      case when p_cost_is_shop then greatest(coalesce(p_cost,0),0) else 0 end)
    returning id into v_product;
    return v_product;
  end if;
  select name, aliases into v_existing from public.products where organization_id=p_org and id=v_product;
  update public.products set
    purchase_price = case when p_cost_is_shop and p_cost > 0 then p_cost else purchase_price end,
    aliases = case
      when lower(v_name) = lower(v_existing.name)
        or exists(select 1 from unnest(v_existing.aliases) a where lower(a)=lower(v_name))
        or cardinality(v_existing.aliases) >= 20
      then aliases else aliases || v_name end
  where organization_id=p_org and id=v_product;
  return v_product;
end
$$;
revoke all on function private.product_for_line(uuid,text,text,numeric,boolean) from public, anon, authenticated;

-- Автоприём: приход проведён, не отменён, ещё не на складе, накладная сверена.
-- Повторный вызов ничего не делает (stocked_at). Возвращает число строк.
create function private.auto_stock_purchase(p_org uuid, p_purchase uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_line record; v_product uuid; v_count integer := 0;
  v_currency text; v_shop_currency text;
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

  select currency into v_shop_currency from public.organizations where id=p_org;
  -- Цены строк — в валюте накладной: исходная валюта записи или валюта долга.
  v_currency := coalesce(v_purchase.original_currency, private.party_currency(p_org,'suppliers',v_purchase.supplier_id));
  for v_line in
    select * from public.document_lines
    where organization_id=p_org and document_id=v_purchase.document_id and qty > 0
    order by n
  loop
    v_product := private.product_for_line(p_org, v_line.name_raw, v_line.unit, v_line.price, v_currency = v_shop_currency);
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
revoke all on function private.auto_stock_purchase(uuid,uuid) from public, anon, authenticated;

-- Накладная прихода стала «сверена» — приход на склад.
create function private.documents_auto_stock() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_purchase uuid;
begin
  for v_purchase in
    select id from public.purchases where organization_id=new.organization_id and document_id=new.id
  loop
    perform private.auto_stock_purchase(new.organization_id, v_purchase);
  end loop;
  return null;
end
$$;
revoke all on function private.documents_auto_stock() from public, anon, authenticated;
create trigger auto_stock after update of status on public.documents
  for each row when (new.status = 'digitized' and old.status is distinct from 'digitized' and new.kind = 'purchase')
  execute function private.documents_auto_stock();

-- Приход записан, когда накладная уже сверена (распознали раньше, чем нажали «Подтвердить»).
create function private.purchases_auto_stock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.auto_stock_purchase(new.organization_id, new.id);
  return null;
end
$$;
revoke all on function private.purchases_auto_stock() from public, anon, authenticated;
create trigger auto_stock after insert on public.purchases
  for each row when (new.document_id is not null)
  execute function private.purchases_auto_stock();

-- Ручной приём по накладной (для старых и несверенных) — как в warehouse.sql,
-- плюс цена за единицу и её валюта у движения; закупочная цена товара — только
-- если накладная в валюте магазина.
create or replace function public.receive_purchase_lines(p_org uuid, p_purchase uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_item jsonb; v_line record; v_product uuid; v_name text; v_unit text;
  v_count integer := 0; v_existing record; v_currency text; v_shop boolean;
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
  v_shop := v_currency = (select currency from public.organizations where id=p_org);
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
        insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price)
        values(p_org,v_name,private.next_product_code(p_org),v_unit,
          case when coalesce(v_item->>'sale_price','') ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
            then (v_item->>'sale_price')::numeric else 0 end,
          case when v_shop then greatest(v_line.price,0) else 0 end)
        returning id into v_product;
      end if;
    end if;
    select name, aliases into v_existing from public.products where organization_id=p_org and id=v_product;
    update public.products set
      purchase_price = case when v_shop and v_line.price > 0 then v_line.price else purchase_price end,
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

-- Приход товарами без фото: строки [{product, qty, price}] — цена закупки в
-- валюте магазина. Сумма записи = сумма строк; у поставщика в другой валюте —
-- по курсу p_fx_rate (как commit_sale_items). Каждая строка — плюс к остатку.
create function public.commit_purchase_items(
  p_org uuid, p_supplier uuid, p_lines jsonb, p_idempotency_key uuid, p_fx_rate text default null
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

  v_hash := md5(jsonb_build_object(
    'supplier_id',p_supplier,'lines',p_lines,
    'fx_rate',case when v_foreign then trim_scale(p_fx_rate::numeric)::text end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.purchases where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  insert into public.purchases(
    organization_id,supplier_id,status,total,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate,stocked_at
  ) values(p_org,p_supplier,'posted',v_amount,p_idempotency_key,v_hash,
    case when v_foreign then v_total end,
    case when v_foreign then v_shop_currency end,
    case when v_foreign then p_fx_rate::numeric end,
    now())
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
      update public.products set purchase_price=v_price where organization_id=p_org and id=v_product.id;
    end if;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,
    jsonb_build_object('total',v_amount::text,'lines',v_n));
  return v_purchase;
end
$$;
revoke all on function public.commit_purchase_items(uuid,uuid,jsonb,uuid,text) from public, anon;
grant execute on function public.commit_purchase_items(uuid,uuid,jsonb,uuid,text) to authenticated;

commit;
