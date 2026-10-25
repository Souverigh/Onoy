-- Приход по фото: товар по коду поставщика и выбор владельца (просьба
-- пользователя 26.10.2026). В накладной Horoz код стоит в начале названия
-- строки («001-006-0020 20W 6400K E27 … PREMIER-20»), а на складе товар
-- называется «Лампа PREMIER-20» с кодом 001-006-0020 — приход искал только по
-- названию и молча заводил новый товар с кодом в названии.
--   product_by_line        — товар строки: по коду из названия, затем по
--                            точному названию или синониму (с кодом и без);
--   purchase_line_product  — товар строки прихода: выбор владельца или поиск;
--                            новый — код в поле «Код», название без кода;
--   purchases.line_products — выбор владельца по строкам фото, как у продажи:
--                            [{"n":1,"product":uuid}] — этот товар,
--                            {"product":null,"new":true} — новый,
--                            {"product":null} — не принимать на склад;
--   commit_purchase(_correction) — принимают p_line_products;
--   receive_purchase_lines — ручной приём ищет так же (раньше — только по
--                            точному названию, без синонимов);
--   merge_products / undo_product_merge — объединить дубль с товаром
--                            (владелец): движения, продажи, приходы, возвраты
--                            и строки накладных переходят к товару, название
--                            дубля — его синоним, дубль — в архив; отмена в
--                            течение суток. Переносит только строки дубля и
--                            пишет в audit_events.
-- Новые колонки пустые, новая таблица; существующие данные не меняются.
begin;

alter table public.purchases add column line_products jsonb
  check (line_products is null or jsonb_typeof(line_products) = 'array');
alter table public.products add column merged_into_id uuid;

-- Код поставщика в начале названия строки: «001-006-0020 …», «052-005-120 …».
-- Только цифровые группы через - . / (не «20W», не «LED-9W»). Нет — null.
create function private.line_code(p_name text) returns text
language sql immutable set search_path='' as $$
  select substring(coalesce(p_name,'') from '^\s*([0-9]{2,}(?:[-./][0-9A-Za-z]+)+)(?:\s|$)')
$$;
revoke all on function private.line_code(text) from public, anon, authenticated;

-- Название строки без кода в начале; пусто после кода — как было.
create function private.line_name(p_name text) returns text
language sql immutable set search_path='' as $$
  select left(coalesce(
    nullif(regexp_replace(regexp_replace(trim(coalesce(p_name,'')), '^[0-9]{2,}(?:[-./][0-9A-Za-z]+)+(\s+|$)', ''), '\s+', ' ', 'g'), ''),
    regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g')), 160)
$$;
revoke all on function private.line_name(text) from public, anon, authenticated;

-- Товар строки накладной: код товара (от 5 знаков, с цифрой — не «1», «38»)
-- стоит словом в названии строки; иначе точное название или синоним — с
-- кодом и без. Только действующие, не объединённые.
create function private.product_by_line(p_org uuid, p_name text) returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select p.id from public.products p
     where p.organization_id = p_org and p.archived_at is null and p.merged_into_id is null
       and p.sku is not null and length(p.sku) >= 5 and p.sku ~ '[0-9]'
       and lower(p.sku) = any(regexp_split_to_array(lower(trim(coalesce(p_name,''))), '\s+'))
     order by (lower(p.sku) = lower(coalesce(private.line_code(p_name),''))) desc, p.created_at
     limit 1),
    private.product_by_exact_name(p_org, p_name),
    private.product_by_exact_name(p_org, private.line_name(p_name))
  )
$$;
revoke all on function private.product_by_line(uuid,text) from public, anon, authenticated;

-- Товар строки прихода. p_choice — выбор владельца ({"product":uuid} /
-- {"new":true} / {"product":null} — не принимать) или null — искать самим.
-- Найден — цена закупки, синоним (название строки) и код, если у товара его
-- нет; не найден — новый товар: код в поле «Код», название без кода.
create function private.purchase_line_product(
  p_org uuid, p_name text, p_unit text, p_cost numeric, p_cost_currency text, p_choice jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_raw text; v_product uuid; v_existing record; v_code text; v_unit text; v_new boolean := false;
begin
  v_raw := left(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'), 160);
  if v_raw = '' then return null; end if;
  v_code := private.line_code(v_raw);
  -- Код уже у другого товара — новому не ставим (у найденного — тоже).
  if v_code is not null and (length(v_code) > 80
    or exists(select 1 from public.products where organization_id=p_org and lower(sku)=lower(v_code)))
  then v_code := null; end if;
  if p_choice is not null then
    if p_choice->>'product' is not null then
      select id into v_product from public.products
      where organization_id=p_org and id=(p_choice->>'product')::uuid and merged_into_id is null;
      if v_product is null then return null; end if;
    elsif coalesce((p_choice->>'new')::boolean, false) then
      v_new := true;
    else
      return null; -- «Не принимать на склад».
    end if;
  else
    v_product := private.product_by_line(p_org, v_raw);
    v_new := v_product is null;
  end if;

  if v_new then
    -- Тот же товар уже заведён (исправление прихода, повтор) — второй не заводим.
    select id into v_product from public.products
    where organization_id=p_org and archived_at is null and merged_into_id is null
      and private.plain_name(name) = private.plain_name(private.line_name(v_raw))
    order by created_at limit 1;
    v_new := v_product is null;
  end if;
  if v_new then
    v_unit := case when p_unit = any(private.product_units()) then p_unit else 'шт' end;
    insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,purchase_currency)
    values(p_org,private.line_name(v_raw),v_code,v_unit,0,greatest(coalesce(p_cost,0),0),
      case when p_cost > 0 then private.cost_currency(p_org, p_cost_currency) end)
    returning id into v_product;
    return v_product;
  end if;

  select name, aliases, sku into v_existing from public.products where organization_id=p_org and id=v_product;
  update public.products set
    purchase_price = case when p_cost > 0 then p_cost else purchase_price end,
    purchase_currency = case when p_cost > 0 then private.cost_currency(p_org, p_cost_currency) else purchase_currency end,
    sku = coalesce(sku, v_code),
    aliases = case
      when private.plain_name(v_raw) = private.plain_name(v_existing.name)
        or exists(select 1 from unnest(v_existing.aliases) a where private.plain_name(a) = private.plain_name(v_raw))
        or cardinality(v_existing.aliases) >= 20
      then aliases else aliases || v_raw end
  where organization_id=p_org and id=v_product;
  return v_product;
end
$$;
revoke all on function private.purchase_line_product(uuid,text,text,numeric,text,jsonb) from public, anon, authenticated;

-- Прежнее имя (без выбора) — тот же поиск.
create or replace function private.product_for_line(
  p_org uuid, p_name text, p_unit text, p_cost numeric, p_cost_currency text
) returns uuid
language sql security definer set search_path='' as $$
  select private.purchase_line_product(p_org, p_name, p_unit, p_cost, p_cost_currency, null)
$$;
revoke all on function private.product_for_line(uuid,text,text,numeric,text) from public, anon, authenticated;

-- Автоприём: как в purchase_currency.sql, плюс выбор владельца по строкам
-- (purchases.line_products) и товар строки в document_lines.product_id.
create or replace function private.auto_stock_purchase(p_org uuid, p_purchase uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_line record; v_product uuid; v_count integer := 0;
  v_currency text; v_choice jsonb;
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

  v_currency := coalesce(v_purchase.original_currency, private.party_currency(p_org,'suppliers',v_purchase.supplier_id));
  for v_line in
    select * from public.document_lines
    where organization_id=p_org and document_id=v_purchase.document_id and qty > 0
    order by n
  loop
    v_choice := null;
    if v_purchase.line_products is not null then
      select c into v_choice from jsonb_array_elements(v_purchase.line_products) c
      where c->>'n' = v_line.n::text limit 1;
    end if;
    v_product := private.purchase_line_product(p_org, v_line.name_raw, v_line.unit, v_line.price, v_currency, v_choice);
    if v_product is null then continue; end if;
    insert into public.inventory_movements(
      organization_id,product_id,qty_delta,reason,purchase_id,unit_cost,cost_currency,created_by)
    values(p_org,v_product,v_line.qty,'purchase',p_purchase,greatest(v_line.price,0),v_currency,
      coalesce(auth.uid(), v_purchase.created_by));
    update public.document_lines set product_id=v_product where organization_id=p_org and id=v_line.id;
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

-- Приход по фото: как в record_date.sql, плюс p_line_products (проверка — как у
-- commit_sale; в хеш идемпотентности — только когда передан).
drop function public.commit_purchase_correction(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,timestamptz);
drop function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz);
create function public.commit_purchase(
  p_org uuid, p_supplier uuid, p_amount text, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null, p_line_products jsonb default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_purchase uuid; v_amount numeric;
  v_converted numeric; v_choice jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_supplier is null
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
  then raise exception 'invalid_purchase'; end if;
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_supplier)
  then raise exception 'invalid_supplier'; end if;
  -- Выбор по строкам: только к накладной; товар — этого магазина, не объединённый.
  if p_line_products is not null then
    if p_document is null or jsonb_typeof(p_line_products) <> 'array'
      or jsonb_array_length(p_line_products) > 200
    then raise exception 'invalid_line'; end if;
    for v_choice in select * from jsonb_array_elements(p_line_products) loop
      if jsonb_typeof(v_choice) <> 'object'
        or coalesce(v_choice->>'n','') !~ '^[1-9][0-9]{0,3}$'
        or not (v_choice ? 'product')
        or (v_choice->>'product' is not null and v_choice->>'product' !~ '^[0-9a-f-]{36}$')
        or (v_choice ? 'new' and jsonb_typeof(v_choice->'new') <> 'boolean')
      then raise exception 'invalid_line'; end if;
      if v_choice->>'product' is not null and not exists(
        select 1 from public.products
        where organization_id=p_org and id=(v_choice->>'product')::uuid and merged_into_id is null
      ) then raise exception 'invalid_product'; end if;
    end loop;
  end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org,'suppliers',p_supplier), p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_purchase'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_purchase'; end if;

  v_hash:=md5((jsonb_build_object('supplier_id',p_supplier,'amount',v_amount::text,'document',p_document)
    || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end
    || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end
    || case when p_line_products is null then '{}'::jsonb
            else jsonb_build_object('line_products',p_line_products) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.purchases where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents
    where organization_id=p_org and id=p_document and kind='purchase'
  ) then raise exception 'invalid_document'; end if;

  insert into public.purchases(
    organization_id,supplier_id,status,total,document_id,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate,occurred_at,line_products
  ) values(p_org,p_supplier,'posted',v_amount,p_document,p_idempotency_key,v_hash,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end,
    coalesce(p_occurred_at, now()),
    p_line_products)
  returning id into v_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,jsonb_build_object('total',v_amount::text));
  return v_purchase;
end
$$;
revoke all on function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz,jsonb) to authenticated;

create function public.commit_purchase_correction(
  p_from uuid, p_made_by uuid,
  p_org uuid, p_supplier uuid, p_amount text, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null, p_line_products jsonb default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_new uuid;
begin
  v_new := public.commit_purchase(p_org, p_supplier, p_amount, p_idempotency_key, p_document,
    p_original_amount, p_original_currency, p_fx_rate, p_occurred_at, p_line_products);
  perform private.finish_correction(p_org, 'purchase', p_from, v_new, p_made_by);
  return v_new;
end
$$;
revoke all on function public.commit_purchase_correction(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,timestamptz,jsonb) from public, anon;
grant execute on function public.commit_purchase_correction(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,timestamptz,jsonb) to authenticated;

-- Ручной приём по накладной: как в purchase_currency.sql, но строка без
-- выбранного товара ищется как в автоприёме (код, название, синоним).
create or replace function public.receive_purchase_lines(p_org uuid, p_purchase uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_item jsonb; v_line record; v_product uuid; v_name text; v_unit text;
  v_count integer := 0; v_currency text; v_sale_price numeric;
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
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_line from public.document_lines
    where organization_id=p_org and document_id=v_purchase.document_id
      and id=case when coalesce(v_item->>'line','') ~ '^[0-9a-f-]{36}$' then (v_item->>'line')::uuid end;
    if not found then raise exception 'invalid_line'; end if;
    if v_line.qty <= 0 then continue; end if;
    v_product := case when coalesce(v_item->>'product','') ~ '^[0-9a-f-]{36}$' then (v_item->>'product')::uuid end;
    if v_product is not null then
      if not exists(select 1 from public.products where organization_id=p_org and id=v_product and merged_into_id is null)
      then raise exception 'invalid_product'; end if;
      v_product := private.purchase_line_product(p_org, v_line.name_raw, v_line.unit, v_line.price, v_currency,
        jsonb_build_object('product', v_product));
    else
      -- Название, исправленное в форме приёма, — вместо распознанного.
      v_name := coalesce(nullif(trim(v_item->>'name'),''), v_line.name_raw);
      v_unit := coalesce(nullif(v_item->>'unit',''), v_line.unit);
      v_product := private.purchase_line_product(p_org, v_name, v_unit, v_line.price, v_currency, null);
      if v_product is null then continue; end if;
      -- Новый товар (заведён этой же транзакцией) — цена продажи из формы.
      v_sale_price := case when coalesce(v_item->>'sale_price','') ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
        then (v_item->>'sale_price')::numeric end;
      if v_sale_price is not null then
        update public.products set sale_price = v_sale_price
        where organization_id=p_org and id=v_product and created_at = now();
      end if;
    end if;
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,purchase_id,unit_cost,cost_currency)
    values(p_org,v_product,v_line.qty,'purchase',p_purchase,greatest(v_line.price,0),v_currency);
    update public.document_lines set product_id=v_product where organization_id=p_org and id=v_line.id;
    v_count := v_count + 1;
  end loop;
  update public.purchases set stocked_at=now() where organization_id=p_org and id=p_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.stocked',p_purchase,jsonb_build_object('lines',v_count));
  return v_count;
end
$$;
revoke all on function public.receive_purchase_lines(uuid,uuid,jsonb) from public, anon;
grant execute on function public.receive_purchase_lines(uuid,uuid,jsonb) to authenticated;

-- Объединённый товар из архива не возвращается: его записи — у другого.
create or replace function public.set_product_archived(p_org uuid, p_product uuid, p_archived boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_name text; v_merged uuid;
begin
  perform private.require_member(p_org);
  select name, merged_into_id into v_name, v_merged from public.products
  where organization_id=p_org and id=p_product for update;
  if not found then raise exception 'invalid_product'; end if;
  if not p_archived and v_merged is not null then raise exception 'product_merged'; end if;
  if not p_archived and exists(select 1 from public.products where organization_id=p_org
      and archived_at is null and lower(name)=lower(v_name) and id<>p_product)
  then raise exception 'name_taken'; end if;
  update public.products set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where organization_id=p_org and id=p_product;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),case when p_archived then 'product.archived' else 'product.restored' end,p_product,'{}'::jsonb);
end
$$;
revoke all on function public.set_product_archived(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_product_archived(uuid,uuid,boolean) to authenticated;

-- Импорт из Excel не возвращает из архива объединённый товар.
create or replace function private.import_product_by_name(p_org uuid, p_name text) returns uuid
language sql stable security definer set search_path='' as $$
  select id from public.products
  where organization_id = p_org and merged_into_id is null and private.product_named(p_name, name, aliases)
  order by (archived_at is null) desc, (lower(name) = lower(p_name)) desc, created_at
  limit 1
$$;
revoke all on function private.import_product_by_name(uuid,text) from public, anon, authenticated;

-- Журнал объединений товаров: что перенесли — чтобы отменить в течение суток.
create table public.product_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  from_id uuid not null,
  into_id uuid not null,
  moved jsonb not null,
  added_aliases text[] not null default '{}',
  from_sku text,
  sku_moved boolean not null default false,
  from_archived_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table public.product_merges enable row level security;
revoke all on public.product_merges from anon, authenticated;
grant select on public.product_merges to authenticated;
create policy tenant_read on public.product_merges for select to authenticated using (private.is_member(organization_id));
create index product_merges_into_idx on public.product_merges(organization_id, into_id, created_at desc);

-- Дубль → товар: всё, что ссылается на дубль, переходит к товару (только
-- строки дубля этого магазина); название и синонимы дубля — синонимы товара
-- (до 20); код дубля — товару, если у того кода нет; дубль — в архив.
create function public.merge_products(p_org uuid, p_from uuid, p_into uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_from record; v_into record; v_aliases text[]; v_id uuid; v_sku_moved boolean := false;
  v_moves uuid[]; v_sale_items uuid[]; v_purchase_items uuid[]; v_returns uuid[]; v_lines uuid[];
begin
  perform private.require_member(p_org);
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_from is null or p_into is null or p_from = p_into then raise exception 'invalid_product'; end if;
  perform 1 from public.organizations where id=p_org for update;
  select id, name, aliases, sku, archived_at into v_from from public.products
  where organization_id=p_org and id=p_from and merged_into_id is null for update;
  if not found then raise exception 'invalid_product'; end if;
  select id, name, aliases, sku into v_into from public.products
  where organization_id=p_org and id=p_into and merged_into_id is null for update;
  if not found then raise exception 'invalid_product'; end if;

  with m as (update public.inventory_movements set product_id=p_into
    where organization_id=p_org and product_id=p_from returning id)
    select coalesce(array_agg(id),'{}') into v_moves from m;
  with m as (update public.sale_items set product_id=p_into
    where organization_id=p_org and product_id=p_from returning id)
    select coalesce(array_agg(id),'{}') into v_sale_items from m;
  with m as (update public.purchase_items set product_id=p_into
    where organization_id=p_org and product_id=p_from returning id)
    select coalesce(array_agg(id),'{}') into v_purchase_items from m;
  with m as (update public.return_items set product_id=p_into
    where organization_id=p_org and product_id=p_from returning id)
    select coalesce(array_agg(id),'{}') into v_returns from m;
  with m as (update public.document_lines set product_id=p_into
    where organization_id=p_org and product_id=p_from returning id)
    select coalesce(array_agg(id),'{}') into v_lines from m;

  select coalesce(array_agg(a), '{}') into v_aliases from (
    select a from (select distinct left(regexp_replace(trim(x), '\s+', ' ', 'g'), 160) as a
                   from unnest(array_prepend(v_from.name, v_from.aliases)) x) t
    where a <> '' and private.plain_name(a) <> private.plain_name(v_into.name)
      and not exists(select 1 from unnest(v_into.aliases) b where private.plain_name(b) = private.plain_name(a))
    limit greatest(0, 20 - cardinality(v_into.aliases))
  ) s;
  -- Код дубля освобождаем (иначе импорт по коду найдёт дубль); товару — если у него нет.
  update public.products set sku=null, merged_into_id=p_into, archived_at=coalesce(archived_at, now())
  where organization_id=p_org and id=p_from;
  if v_into.sku is null and v_from.sku is not null then
    v_sku_moved := true;
  end if;
  update public.products set
    aliases = aliases || v_aliases,
    sku = case when v_sku_moved then v_from.sku else sku end
  where organization_id=p_org and id=p_into;

  insert into public.product_merges(organization_id,from_id,into_id,moved,added_aliases,from_sku,sku_moved,from_archived_at)
  values(p_org,p_from,p_into,jsonb_build_object(
      'inventory_movements',to_jsonb(v_moves),'sale_items',to_jsonb(v_sale_items),
      'purchase_items',to_jsonb(v_purchase_items),'return_items',to_jsonb(v_returns),
      'document_lines',to_jsonb(v_lines)),
    v_aliases,v_from.sku,v_sku_moved,v_from.archived_at)
  returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'product.merged',p_into,jsonb_build_object('from',p_from,'merge',v_id,
    'movements',cardinality(v_moves)));
  return v_id;
end
$$;
revoke all on function public.merge_products(uuid,uuid,uuid) from public, anon;
grant execute on function public.merge_products(uuid,uuid,uuid) to authenticated;

-- Отмена объединения в течение суток: обратно ровно то, что перенесли.
create function public.undo_product_merge(p_org uuid, p_merge uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v record;
begin
  perform private.require_member(p_org);
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  perform 1 from public.organizations where id=p_org for update;
  select * into v from public.product_merges
  where organization_id=p_org and id=p_merge and undone_at is null and created_at > now() - interval '1 day'
  for update;
  if not found then raise exception 'undo_expired'; end if;
  update public.inventory_movements set product_id=v.from_id
  where organization_id=p_org and product_id=v.into_id
    and id in (select jsonb_array_elements_text(v.moved->'inventory_movements')::uuid);
  update public.sale_items set product_id=v.from_id
  where organization_id=p_org and product_id=v.into_id
    and id in (select jsonb_array_elements_text(v.moved->'sale_items')::uuid);
  update public.purchase_items set product_id=v.from_id
  where organization_id=p_org and product_id=v.into_id
    and id in (select jsonb_array_elements_text(v.moved->'purchase_items')::uuid);
  update public.return_items set product_id=v.from_id
  where organization_id=p_org and product_id=v.into_id
    and id in (select jsonb_array_elements_text(v.moved->'return_items')::uuid);
  update public.document_lines set product_id=v.from_id
  where organization_id=p_org and product_id=v.into_id
    and id in (select jsonb_array_elements_text(v.moved->'document_lines')::uuid);
  update public.products set
    aliases = array(select a from unnest(aliases) a where not (a = any(v.added_aliases))),
    sku = case when v.sku_moved and sku = v.from_sku then null else sku end
  where organization_id=p_org and id=v.into_id;
  -- Код дубля — обратно, если его никто не занял за это время.
  update public.products set merged_into_id=null, archived_at=v.from_archived_at,
    sku = case when v.from_sku is not null and not exists(
      select 1 from public.products o where o.organization_id=p_org and lower(o.sku)=lower(v.from_sku))
      then v.from_sku end
  where organization_id=p_org and id=v.from_id;
  update public.product_merges set undone_at=now() where id=v.id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'product.merge_undone',v.into_id,jsonb_build_object('merge',v.id));
end
$$;
revoke all on function public.undo_product_merge(uuid,uuid) from public, anon;
grant execute on function public.undo_product_merge(uuid,uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261026100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
