-- Склад (просьба пользователя 30.09.2026): справочник товаров с кодом и
-- единицей, остатки, продажа накладной прямо в приложении (строки товаров —
-- основание записи, фото не нужно), приём на склад по распознанной накладной
-- поставщика, импорт прайса из Excel. Решения пользователя: продажа строками
-- списывает остаток (продать больше остатка можно — форма предупреждает),
-- товары и цены меняют все участники магазина.
-- Таблицы products / sale_items / inventory_movements есть с foundation.sql —
-- здесь только новые колонки, проверки, вид и функции. Существующие строки
-- не меняются.
-- Остаток считается видом product_balances: движения отменённых продаж и
-- приходов не учитываются — reverse_* / undo_recent менять не нужно.
begin;

-- Единицы — шире, чем было (м², м³, рулон, мешок…); старые значения входят.
create function private.product_units() returns text[]
language sql immutable set search_path='' as $$
  select array['шт','м','м²','м³','кг','т','л','упак','пачка','рулон','мешок','лист','компл','пара']
$$;
revoke all on function private.product_units() from public, anon, authenticated;
alter table public.products drop constraint products_unit_check;
-- Список — копия private.product_units(): проверка выполняется и при прямой
-- вставке участником, а схема private ему не видна.
alter table public.products add constraint products_unit_check check (unit in
  ('шт','м','м²','м³','кг','т','л','упак','пачка','рулон','мешок','лист','компл','пара'));
alter table public.products
  add column archived_at timestamptz,
  add column created_by uuid default auth.uid() references auth.users(id);
create index products_org_sku_idx on public.products(organization_id, lower(sku));

-- Строка накладной: единица на момент продажи и порядок строк.
alter table public.sale_items
  add column unit text,
  add column n integer check (n is null or n > 0);
create index sale_items_product_idx on public.sale_items(organization_id, product_id);

-- Движение склада: «пришло» без накладной (receipt), заметка, автор, ключ
-- от двойного нажатия.
alter table public.inventory_movements drop constraint inventory_movements_reason_check;
alter table public.inventory_movements drop constraint inventory_movements_check;
alter table public.inventory_movements
  add constraint inventory_movements_reason_check
    check (reason in ('purchase','sale','opening','adjustment','receipt')),
  add constraint inventory_movements_check check (
    (reason='sale' and sale_id is not null and purchase_id is null and qty_delta<0) or
    (reason='purchase' and purchase_id is not null and sale_id is null and qty_delta>0) or
    (reason='receipt' and purchase_id is null and sale_id is null and qty_delta>0) or
    (reason in ('opening','adjustment') and purchase_id is null and sale_id is null)),
  add column note text check (note is null or length(note) <= 200),
  add column created_by uuid default auth.uid() references auth.users(id),
  add column idempotency_key uuid;
create unique index inventory_movements_idempotency_idx
  on public.inventory_movements(organization_id, idempotency_key) where idempotency_key is not null;

-- Приход уже принят на склад (строки его накладной добавлены в остатки).
alter table public.purchases add column stocked_at timestamptz;

create trigger reject_blocked_shop before insert or update on public.inventory_movements
  for each row execute function private.reject_blocked_shop();
create trigger reject_blocked_shop before insert or update on public.sale_items
  for each row execute function private.reject_blocked_shop();

-- Остаток без отменённых записей; sold_count — сколько раз товар продавали
-- за 90 дней (частые — выше в форме продажи). Колонки до stock — как были.
create or replace view public.product_balances with (security_invoker=true) as
 select p.id,p.organization_id,p.created_at,p.name,p.sku,p.aliases,p.unit,
   p.purchase_price::text,p.sale_price::text,p.min_stock::text,
   coalesce((
     select sum(m.qty_delta) from public.inventory_movements m
     left join public.sales s on s.organization_id=m.organization_id and s.id=m.sale_id
     left join public.purchases pu on pu.organization_id=m.organization_id and pu.id=m.purchase_id
     where m.organization_id=p.organization_id and m.product_id=p.id
       and s.reversed_at is null and pu.reversed_at is null
   ),0)::text as stock,
   p.archived_at,
   (select count(*) from public.sale_items i
    join public.sales s on s.organization_id=i.organization_id and s.id=i.sale_id
    where i.organization_id=p.organization_id and i.product_id=p.id
      and s.reversed_at is null and s.created_at > now() - interval '90 days')::integer as sold_count
 from public.products p;

-- Остаток одного товара (для функций ниже; права — только у них).
create function private.product_stock(p_org uuid, p_product uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(m.qty_delta),0) from public.inventory_movements m
  left join public.sales s on s.organization_id=m.organization_id and s.id=m.sale_id
  left join public.purchases pu on pu.organization_id=m.organization_id and pu.id=m.purchase_id
  where m.organization_id=p_org and m.product_id=p_product
    and s.reversed_at is null and pu.reversed_at is null
$$;
revoke all on function private.product_stock(uuid,uuid) from public, anon, authenticated;

-- Следующий свободный числовой код товара в магазине: 1, 2, 3…
create function private.next_product_code(p_org uuid) returns text
language sql stable security definer set search_path='' as $$
  select (coalesce(max(sku::bigint),0) + 1)::text from public.products
  where organization_id=p_org and sku ~ '^[0-9]{1,12}$'
$$;
revoke all on function private.next_product_code(uuid) from public, anon, authenticated;

create function private.require_member(p_org uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
end
$$;
revoke all on function private.require_member(uuid) from public, anon, authenticated;

-- Новый товар или правка. Пустой код — присвоим следующий номер. Название
-- не должно повторять другой действующий товар (иначе импорт и поиск путают
-- их). Начальный остаток — только при создании.
create function public.save_product(
  p_org uuid, p_id uuid, p_name text, p_sku text, p_unit text,
  p_sale_price text, p_purchase_price text default '0', p_min_stock text default '0',
  p_aliases text[] default null, p_opening_stock text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_old_sku text; v_old_aliases text[]; v_old_price numeric;
  v_name text := regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_sku text := nullif(trim(coalesce(p_sku,'')), '');
  v_aliases text[];
begin
  perform private.require_member(p_org);
  -- Магазин блокируем: два новых товара подряд не получат один код.
  perform 1 from public.organizations where id=p_org for update;
  if length(v_name) not between 1 and 160 then raise exception 'invalid_name'; end if;
  if p_unit is null or not (p_unit = any(private.product_units())) then raise exception 'invalid_unit'; end if;
  if coalesce(p_sale_price,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or coalesce(p_purchase_price,'0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_price'; end if;
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
    insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price,min_stock,aliases)
    values(p_org,v_name,v_sku,p_unit,p_sale_price::numeric,coalesce(p_purchase_price,'0')::numeric,
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
      purchase_price=coalesce(p_purchase_price,'0')::numeric, min_stock=coalesce(p_min_stock,'0')::numeric,
      aliases=v_aliases
    where organization_id=p_org and id=p_id;
    v_id := p_id;
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'product.updated',v_id,jsonb_build_object('name',v_name,
      'sale_price',p_sale_price,'old_sale_price',v_old_price::text));
  end if;
  return v_id;
end
$$;

create function public.set_product_archived(p_org uuid, p_product uuid, p_archived boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_name text;
begin
  perform private.require_member(p_org);
  select name into v_name from public.products where organization_id=p_org and id=p_product for update;
  if not found then raise exception 'invalid_product'; end if;
  -- Вернуть из архива можно, только если имя не занято другим действующим.
  if not p_archived and exists(select 1 from public.products where organization_id=p_org
      and archived_at is null and lower(name)=lower(v_name) and id<>p_product)
  then raise exception 'name_taken'; end if;
  update public.products set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where organization_id=p_org and id=p_product;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),case when p_archived then 'product.archived' else 'product.restored' end,p_product,'{}'::jsonb);
end
$$;

-- Остаток вручную: «пришло» (+), «списать» (−, нужна причина), «пересчёт»
-- (сколько есть на самом деле). Возвращает новый остаток.
create function public.adjust_stock(
  p_org uuid, p_product uuid, p_mode text, p_qty text, p_note text, p_idempotency_key uuid
) returns numeric
language plpgsql security definer set search_path='' as $$
declare v_stock numeric; v_delta numeric; v_note text := nullif(trim(coalesce(p_note,'')), '');
begin
  perform private.require_member(p_org);
  if p_idempotency_key is null or p_mode not in ('receipt','writeoff','count')
    or coalesce(p_qty,'') !~ '^[0-9]{1,13}(\.[0-9]{1,3})?$'
    or (v_note is not null and length(v_note) > 200)
  then raise exception 'invalid_input'; end if;
  perform 1 from public.products where organization_id=p_org and id=p_product for update;
  if not found then raise exception 'invalid_product'; end if;
  if exists(select 1 from public.inventory_movements where organization_id=p_org and idempotency_key=p_idempotency_key)
  then return private.product_stock(p_org, p_product); end if;
  v_stock := private.product_stock(p_org, p_product);
  if p_mode = 'count' then v_delta := p_qty::numeric - v_stock;
  elsif p_mode = 'receipt' then v_delta := p_qty::numeric;
  else
    if v_note is null then raise exception 'note_required'; end if;
    v_delta := -p_qty::numeric;
  end if;
  if p_mode <> 'count' and v_delta = 0 then raise exception 'invalid_input'; end if;
  if v_delta <> 0 then
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,note,idempotency_key)
    values(p_org,p_product,v_delta,case when p_mode='receipt' then 'receipt' else 'adjustment' end,
      coalesce(v_note, case p_mode when 'count' then 'Пересчёт' end),p_idempotency_key);
  end if;
  return v_stock + v_delta;
end
$$;

-- Продажа накладной из приложения: строки [{product, qty, price}] — цены в
-- валюте магазина. Сумма записи = сумма строк; у клиента в другой валюте —
-- по курсу p_fx_rate (исходная сумма и курс хранятся, как у commit_sale).
-- Каждая строка списывает остаток.
create function public.commit_sale_items(
  p_org uuid, p_customer uuid, p_lines jsonb, p_paid_immediately boolean,
  p_idempotency_key uuid, p_fx_rate text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_line jsonb; v_product record; v_total numeric := 0; v_amount numeric; v_hash text;
  v_existing uuid; v_existing_hash text; v_sale uuid; v_shop_currency text; v_party_currency text;
  v_n integer := 0; v_qty numeric; v_price numeric; v_foreign boolean;
begin
  perform private.require_member(p_org);
  if p_idempotency_key is null or p_customer is null or p_paid_immediately is null
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 200
  then raise exception 'invalid_sale'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_customer'; end if;
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
  if v_total <= 0 or v_total >= 100000000000000 then raise exception 'invalid_sale'; end if;

  select currency into v_shop_currency from public.organizations where id=p_org;
  v_party_currency := private.party_currency(p_org,'customers',p_customer);
  v_foreign := v_party_currency is distinct from v_shop_currency;
  if v_foreign then
    v_amount := private.converted_amount(v_party_currency, v_total::text, v_shop_currency, p_fx_rate);
  else
    v_amount := v_total;
  end if;

  v_hash := md5(jsonb_build_object(
    'customer_id',p_customer,'lines',p_lines,'paid_immediately',p_paid_immediately,
    'fx_rate',case when v_foreign then trim_scale(p_fx_rate::numeric)::text end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate
  ) values(p_org,p_customer,'posted',v_amount,p_paid_immediately,p_idempotency_key,v_hash,
    case when v_foreign then v_total end,
    case when v_foreign then v_shop_currency end,
    case when v_foreign then p_fx_rate::numeric end)
  returning id into v_sale;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_qty := (v_line->>'qty')::numeric;
    v_price := (v_line->>'price')::numeric;
    select id,name,unit into v_product from public.products
    where organization_id=p_org and id=(v_line->>'product')::uuid;
    insert into public.sale_items(organization_id,sale_id,product_id,name_snapshot,unit,n,qty,price)
    values(p_org,v_sale,v_product.id,v_product.name,v_product.unit,v_n,v_qty,v_price);
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,sale_id)
    values(p_org,v_product.id,-v_qty,'sale',v_sale);
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.posted',v_sale,
    jsonb_build_object('total',v_amount::text,'paid_immediately',p_paid_immediately,'lines',v_n));
  return v_sale;
end
$$;

-- Приём на склад по распознанной накладной прихода: [{line, product?, name?,
-- unit?, sale_price?}]. Без product — новый товар (или действующий с тем же
-- названием). Название со строки накладной запоминается синонимом товара —
-- в следующий раз он найдётся сам. Цена закупки товара — с этой накладной.
create function public.receive_purchase_lines(p_org uuid, p_purchase uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record; v_item jsonb; v_line record; v_product uuid; v_name text; v_unit text;
  v_count integer := 0; v_existing record;
begin
  perform private.require_member(p_org);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200
  then raise exception 'invalid_input'; end if;
  perform 1 from public.organizations where id=p_org for update;
  select * into v_purchase from public.purchases where organization_id=p_org and id=p_purchase for update;
  if not found or v_purchase.reversed_at is not null or v_purchase.document_id is null
  then raise exception 'invalid_purchase'; end if;
  if v_purchase.stocked_at is not null then raise exception 'already_stocked'; end if;
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
          greatest(v_line.price,0))
        returning id into v_product;
      end if;
    end if;
    select name, aliases into v_existing from public.products where organization_id=p_org and id=v_product;
    update public.products set
      purchase_price = case when v_line.price > 0 then v_line.price else purchase_price end,
      aliases = case
        when lower(v_line.name_raw) = lower(v_existing.name)
          or exists(select 1 from unnest(v_existing.aliases) a where lower(a)=lower(v_line.name_raw))
          or cardinality(v_existing.aliases) >= 20
        then aliases else aliases || left(trim(v_line.name_raw),160) end
    where organization_id=p_org and id=v_product;
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,purchase_id)
    values(p_org,v_product,v_line.qty,'purchase',p_purchase);
    v_count := v_count + 1;
  end loop;
  update public.purchases set stocked_at=now() where organization_id=p_org and id=p_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.stocked',p_purchase,jsonb_build_object('lines',v_count));
  return v_count;
end
$$;

-- Импорт прайса: [{name, sku?, unit?, sale_price?, purchase_price?, stock?}],
-- до 2000 строк. Товар ищется по коду, затем по названию; найденный
-- обновляется (пустые поля не трогаем), остаток — «пересчётом» (повторный
-- импорт того же файла ничего не задвоит). Плохие строки пропускаются с
-- причиной, остальные сохраняются.
create function public.import_products(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_row jsonb; v_i integer := 0; v_created integer := 0; v_updated integer := 0; v_errors jsonb := '[]';
  v_id uuid; v_old record; v_name text; v_sku text; v_unit text; v_stock text; v_delta numeric; v_by_sku boolean;
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
      if length(v_name) not between 1 and 160 then raise exception 'invalid_name'; end if;
      if v_unit is not null and not (v_unit = any(private.product_units())) then raise exception 'invalid_unit'; end if;
      if coalesce(v_row->>'sale_price','0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
        or coalesce(v_row->>'purchase_price','0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
      then raise exception 'invalid_price'; end if;
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
        insert into public.products(organization_id,name,sku,unit,sale_price,purchase_price)
        values(p_org,v_name,coalesce(v_sku,private.next_product_code(p_org)),coalesce(v_unit,'шт'),
          coalesce(nullif(v_row->>'sale_price',''),'0')::numeric,
          coalesce(nullif(v_row->>'purchase_price',''),'0')::numeric)
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
          purchase_price = coalesce(nullif(v_row->>'purchase_price','')::numeric, purchase_price),
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

revoke all on function public.save_product(uuid,uuid,text,text,text,text,text,text,text[],text) from public,anon;
revoke all on function public.set_product_archived(uuid,uuid,boolean) from public,anon;
revoke all on function public.adjust_stock(uuid,uuid,text,text,text,uuid) from public,anon;
revoke all on function public.commit_sale_items(uuid,uuid,jsonb,boolean,uuid,text) from public,anon;
revoke all on function public.receive_purchase_lines(uuid,uuid,jsonb) from public,anon;
revoke all on function public.import_products(uuid,jsonb) from public,anon;
grant execute on function public.save_product(uuid,uuid,text,text,text,text,text,text,text[],text) to authenticated;
grant execute on function public.set_product_archived(uuid,uuid,boolean) to authenticated;
grant execute on function public.adjust_stock(uuid,uuid,text,text,text,uuid) to authenticated;
grant execute on function public.commit_sale_items(uuid,uuid,jsonb,boolean,uuid,text) to authenticated;
grant execute on function public.receive_purchase_lines(uuid,uuid,jsonb) to authenticated;
grant execute on function public.import_products(uuid,jsonb) to authenticated;

-- Накладная клиенту по ссылке: продажа строками отдаётся из sale_items
-- (она сверена по определению — сумма и есть сумма строк). Продажа по фото —
-- как раньше, через private.get_invoice_by_token_unchecked.
create or replace function public.get_invoice_by_token(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_sale record; v_currency text; v_shop record;
begin
  select l.organization_id, l.customer_id, c.name as customer_name into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if found then
    v_currency := private.party_currency(v_link.organization_id,'customers',v_link.customer_id);
    select s.* into v_sale from public.sales s
    where s.organization_id=v_link.organization_id and s.id=p_sale and s.customer_id=v_link.customer_id
      and s.status='posted' and s.reversed_at is null and not s.is_opening
      and exists(select 1 from public.sale_items i where i.organization_id=s.organization_id and i.sale_id=s.id);
    if found then
      select o.name, o.phone into v_shop from public.organizations o where o.id=v_link.organization_id;
      return jsonb_build_object(
        'shop_name', v_shop.name,
        'shop_phone', v_shop.phone,
        'customer_name', v_link.customer_name,
        'total', coalesce(v_sale.original_amount, v_sale.total)::text,
        'currency', coalesce(v_sale.original_currency, v_currency, 'KGS'),
        'occurred_at', v_sale.occurred_at,
        'paid_immediately', v_sale.paid_immediately,
        'items', true,
        'lines', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'n', coalesce(i.n, 0), 'name_raw', i.name_snapshot, 'qty', i.qty::text, 'unit', coalesce(i.unit,'шт'),
            'price', i.price::text, 'sum', i.line_total::text) order by i.n, i.created_at), '[]'::jsonb)
          from public.sale_items i where i.organization_id=v_sale.organization_id and i.sale_id=v_sale.id
        )
      );
    end if;
  end if;
  return private.get_invoice_by_token_unchecked(p_token, p_sale)
    || jsonb_build_object('currency', coalesce(v_currency,'KGS'));
end
$$;

-- Страница клиента: у продажи строками тоже есть «Накладная PDF». Тело — как
-- в claim_original_currency.sql, плюс флаг invoice у таких продаж.
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_currency text; v_originals jsonb; v_result jsonb; v_item_sales uuid[];
begin
  select * into v_link from public.share_links l where l.token=p_token and l.revoked_at is null;
  if found then
    v_currency := private.party_currency(v_link.organization_id,'customers',v_link.customer_id);
    select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
      'amount', p.original_amount::text, 'currency', p.original_currency, 'rate', p.fx_rate::text)), '{}'::jsonb)
    into v_originals
    from public.payments p
    where p.organization_id=v_link.organization_id and p.customer_id=v_link.customer_id
      and p.original_currency is not null;
    select coalesce(array_agg(s.id), '{}') into v_item_sales from public.sales s
    where s.organization_id=v_link.organization_id and s.customer_id=v_link.customer_id
      and s.reversed_at is null and not s.is_opening
      and exists(select 1 from public.sale_items i where i.organization_id=s.organization_id and i.sale_id=s.id);
  end if;
  v_result := private.get_statement_by_token_unchecked(p_token)
    || jsonb_build_object('currency', coalesce(v_currency,'KGS'), 'originals', coalesce(v_originals,'{}'::jsonb));
  if cardinality(v_item_sales) > 0 then
    v_result := jsonb_set(v_result, '{entries}', (
      select coalesce(jsonb_agg(
        case when e->>'kind'='sale' and (e->>'id')::uuid = any(v_item_sales) then e || '{"invoice":true}'::jsonb else e end
        order by i), '[]'::jsonb)
      from jsonb_array_elements(v_result->'entries') with ordinality as t(e, i)));
  end if;
  return v_result;
end
$$;

commit;
