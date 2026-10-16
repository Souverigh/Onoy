-- Продажа по фото списывает со склада (просьба пользователя 15.10.2026).
-- Строки сверенной накладной продажи уменьшают остаток товара:
-- * продавец в форме выбрал товар для строки (точное совпадение, «Да» на
--   похожий или «Другой товар») — списываем его, а название строки
--   запоминаем синонимом товара: в следующий раз совпадёт точно;
-- * продавец выбрал «Не списывать» — строку пропускаем;
-- * выбора нет (старая форма) — только точное совпадение названия с товаром
--   или его синонимом, без учёта регистра, «ё» и лишних пробелов.
-- Новых товаров не заводим. Как автоприём прихода (auto_stock.sql):
-- срабатывает, когда накладная стала «сверена» или продажа записана по уже
-- сверенной. Старые продажи не трогаем: данные не меняются, только новые
-- колонки (пустые), функции и триггеры.
begin;

-- Продажа уже списана со склада (повторно не списываем).
alter table public.sales add column stocked_at timestamptz;
-- Выбор продавца по строкам фото: [{"n": 1, "product": uuid или null}].
-- Строки накладной сохраняются после записи продажи, поэтому выбор ждёт здесь.
alter table public.sales add column line_products jsonb
  check (line_products is null or jsonb_typeof(line_products) = 'array');
-- Товар, на который списана строка фото: возврат этой строки вернёт его на склад.
alter table public.document_lines add column product_id uuid;
alter table public.document_lines
  add constraint document_lines_product_fk foreign key (organization_id, product_id)
  references public.products(organization_id, id);

-- Название для точного сравнения: регистр, «ё» и пробелы не важны.
create function private.plain_name(p_name text) returns text
language sql immutable set search_path='' as $$
  select replace(lower(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g')), 'ё', 'е')
$$;
revoke all on function private.plain_name(text) from public, anon, authenticated;

-- Товар по точному названию строки: имя или синоним действующего товара.
create function private.product_by_exact_name(p_org uuid, p_name text) returns uuid
language sql stable security definer set search_path='' as $$
  select p.id from public.products p
  where p.organization_id=p_org and p.archived_at is null
    and private.plain_name(p_name) <> ''
    and (private.plain_name(p.name) = private.plain_name(p_name)
      or exists(select 1 from unnest(p.aliases) a where private.plain_name(a) = private.plain_name(p_name)))
  order by (private.plain_name(p.name) = private.plain_name(p_name)) desc, p.created_at
  limit 1
$$;
revoke all on function private.product_by_exact_name(uuid,text) from public, anon, authenticated;

-- Автосписание: продажа проведена, не отменена, ещё не списана, без строк
-- со склада (sale_items — те списались сами), накладная сверена.
-- Возвращает число списанных строк.
create function private.auto_stock_sale(p_org uuid, p_sale uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_sale record; v_line record; v_product uuid; v_count integer := 0; v_choice jsonb;
  v_existing record;
begin
  select * into v_sale from public.sales
  where organization_id=p_org and id=p_sale for update;
  if not found or v_sale.status <> 'posted' or v_sale.reversed_at is not null
    or v_sale.stocked_at is not null or v_sale.document_id is null or v_sale.is_opening
  then return 0; end if;
  if exists(select 1 from public.sale_items where organization_id=p_org and sale_id=p_sale)
  then return 0; end if;
  if not exists(select 1 from public.documents
    where organization_id=p_org and id=v_sale.document_id and status='digitized' and kind='sale')
  then return 0; end if;
  if not exists(select 1 from public.document_lines
    where organization_id=p_org and document_id=v_sale.document_id and qty > 0)
  then return 0; end if;

  for v_line in
    select * from public.document_lines
    where organization_id=p_org and document_id=v_sale.document_id and qty > 0
    order by n
  loop
    v_choice := null;
    if v_sale.line_products is not null then
      select c into v_choice from jsonb_array_elements(v_sale.line_products) c
      where c->>'n' = v_line.n::text limit 1;
    end if;
    if v_choice is null then
      -- Продавец эту строку не видел (старая форма или строку добавили позже).
      v_product := private.product_by_exact_name(p_org, v_line.name_raw);
    elsif v_choice->>'product' is not null then
      select id, name, aliases into v_existing from public.products
      where organization_id=p_org and id=(v_choice->>'product')::uuid;
      v_product := v_existing.id;
      -- Название с фото — синонимом товара (не больше 20, как у прихода).
      if v_product is not null
        and private.plain_name(v_line.name_raw) <> private.plain_name(v_existing.name)
        and not exists(select 1 from unnest(v_existing.aliases) a
          where private.plain_name(a) = private.plain_name(v_line.name_raw))
        and cardinality(v_existing.aliases) < 20
      then
        update public.products
        set aliases = aliases || left(regexp_replace(trim(v_line.name_raw), '\s+', ' ', 'g'), 160)
        where organization_id=p_org and id=v_product;
      end if;
    else
      -- «Не списывать со склада».
      v_product := null;
    end if;
    if v_product is null then continue; end if;
    insert into public.inventory_movements(organization_id,product_id,qty_delta,reason,sale_id,created_by)
    values(p_org,v_product,-v_line.qty,'sale',p_sale,coalesce(auth.uid(), v_sale.created_by));
    update public.document_lines set product_id=v_product
    where organization_id=p_org and id=v_line.id;
    v_count := v_count + 1;
  end loop;
  update public.sales set stocked_at=now() where organization_id=p_org and id=p_sale;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,coalesce(auth.uid(), v_sale.created_by),'sale.stocked',p_sale,
    jsonb_build_object('lines',v_count,'auto',true));
  return v_count;
end
$$;
revoke all on function private.auto_stock_sale(uuid,uuid) from public, anon, authenticated;

-- Накладная продажи стала «сверена» — списание.
create function private.documents_auto_stock_sale() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_sale uuid;
begin
  for v_sale in
    select id from public.sales where organization_id=new.organization_id and document_id=new.id
  loop
    perform private.auto_stock_sale(new.organization_id, v_sale);
  end loop;
  return null;
end
$$;
revoke all on function private.documents_auto_stock_sale() from public, anon, authenticated;
create trigger auto_stock_sale after update of status on public.documents
  for each row when (new.status = 'digitized' and old.status is distinct from 'digitized' and new.kind = 'sale')
  execute function private.documents_auto_stock_sale();

-- Продажа записана, когда накладная уже сверена.
create function private.sales_auto_stock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.auto_stock_sale(new.organization_id, new.id);
  return null;
end
$$;
revoke all on function private.sales_auto_stock() from public, anon, authenticated;
create trigger auto_stock after insert on public.sales
  for each row when (new.document_id is not null)
  execute function private.sales_auto_stock();

-- Продажа по фото с выбором товаров для строк (p_line_products). Тело — как в
-- sale_date.sql; выбор проверяется и хранится в sales.line_products, в хеш
-- идемпотентности входит, только когда передан (прежние повторы — как были).
drop function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz);
create function public.commit_sale(
  p_org uuid, p_customer uuid, p_amount text, p_paid_immediately boolean, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null, p_line_products jsonb default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_sale uuid; v_amount numeric;
  v_converted numeric; v_choice jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_customer is null or p_paid_immediately is null
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
  then raise exception 'invalid_sale'; end if;
  -- Продажа за прошлый день (задача 15): не в будущем и не старше года.
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer)
  then raise exception 'invalid_customer'; end if;
  -- Выбор товаров: только к накладной; строка по номеру, товар — этого магазина или null.
  if p_line_products is not null then
    if p_document is null or jsonb_typeof(p_line_products) <> 'array'
      or jsonb_array_length(p_line_products) > 200
    then raise exception 'invalid_line'; end if;
    for v_choice in select * from jsonb_array_elements(p_line_products) loop
      if jsonb_typeof(v_choice) <> 'object'
        or coalesce(v_choice->>'n','') !~ '^[1-9][0-9]{0,3}$'
        or not (v_choice ? 'product')
        or (v_choice->>'product' is not null and v_choice->>'product' !~ '^[0-9a-f-]{36}$')
      then raise exception 'invalid_line'; end if;
      if v_choice->>'product' is not null and not exists(
        select 1 from public.products where organization_id=p_org and id=(v_choice->>'product')::uuid
      ) then raise exception 'invalid_product'; end if;
    end loop;
  end if;
  v_converted := private.converted_amount(
    private.party_currency(p_org,'customers',p_customer), p_original_amount, p_original_currency, p_fx_rate);
  if v_converted is not null then v_amount := v_converted;
  else
    if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_sale'; end if;
    v_amount:=p_amount::numeric;
  end if;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_sale'; end if;

  v_hash:=md5((jsonb_build_object(
    'customer_id',p_customer,'amount',v_amount::text,
    'paid_immediately',p_paid_immediately,'document',p_document
  ) || case when v_converted is null then '{}'::jsonb else jsonb_build_object(
      'original_amount',trim_scale(p_original_amount::numeric)::text,'original_currency',p_original_currency,
      'fx_rate',trim_scale(p_fx_rate::numeric)::text) end
    || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end
    || case when p_line_products is null then '{}'::jsonb
            else jsonb_build_object('line_products',p_line_products) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='sale'
  ) then raise exception 'invalid_document'; end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,document_id,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate,occurred_at,line_products
  ) values(p_org,p_customer,'posted',v_amount,p_paid_immediately,p_document,p_idempotency_key,v_hash,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end,
    coalesce(p_occurred_at, now()),
    p_line_products)
  returning id into v_sale;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.posted',v_sale,
    jsonb_build_object('total',v_amount::text,'paid_immediately',p_paid_immediately));
  return v_sale;
end
$$;
revoke all on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.commit_sale(uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz,jsonb) to authenticated;

-- Возврат строкой фото: как в return_items.sql, но товар — тот, на который
-- строка была списана (document_lines.product_id): он возвращается на склад.
create or replace function public.commit_return(
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
      select null::uuid as sale_item_id, l.id as document_line_id, l.product_id, l.name_raw as name,
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

commit;
