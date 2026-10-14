-- Приход товарами — в валюте поставщика (просьба пользователя 13.10.2026):
-- у долларового поставщика цены строк вводятся в $, долг растёт ровно на
-- сумму строк, без курса; цена закупки товара запоминается в $.
-- Прежний режим (цены в валюте магазина + p_fx_rate, пересчёт в валюту
-- поставщика) остаётся для старой формы, открытой до обновления: она
-- присылает курс, новая — нет. Данные не меняются — только тело функции.
begin;

create or replace function public.commit_purchase_items(
  p_org uuid, p_supplier uuid, p_lines jsonb, p_idempotency_key uuid, p_fx_rate text default null,
  p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_line jsonb; v_product record; v_total numeric := 0; v_amount numeric; v_hash text;
  v_existing uuid; v_existing_hash text; v_purchase uuid; v_shop_currency text; v_party_currency text;
  v_n integer := 0; v_qty numeric; v_price numeric; v_foreign boolean;
  v_line_currency text; v_cost_currency text;
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
  -- Курс прислала только старая форма: цены в валюте магазина, пересчёт.
  v_foreign := v_party_currency is distinct from v_shop_currency and p_fx_rate is not null;
  if v_foreign then
    v_amount := private.converted_amount(v_party_currency, v_total::text, v_shop_currency, p_fx_rate);
    v_line_currency := v_shop_currency;
  else
    v_amount := v_total;
    v_line_currency := v_party_currency;
  end if;
  v_cost_currency := private.cost_currency(p_org, v_line_currency);

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
    values(p_org,v_product.id,v_qty,'purchase',v_purchase,v_price,v_line_currency);
    if v_price > 0 then
      update public.products set purchase_price=v_price, purchase_currency=v_cost_currency
      where organization_id=p_org and id=v_product.id;
    end if;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,
    jsonb_build_object('total',v_amount::text,'lines',v_n));
  return v_purchase;
end
$$;

commit;
