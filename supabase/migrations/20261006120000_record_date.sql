-- Запись задним числом (срочно до запуска, п. 2): «забыл записать вчера».
-- Дата, как у commit_sale (20261005120000_sale_date.sql), теперь и у товара
-- от поставщика по фото / без накладной, и у продажи и прихода товарами.
-- Пересоздание функций с p_occurred_at; тела прежние, данные не меняются.
-- Без даты хеш идемпотентности прежний.
begin;

drop function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text);
create function public.commit_purchase(
  p_org uuid, p_supplier uuid, p_amount text, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_purchase uuid; v_amount numeric;
  v_converted numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_supplier is null
    or (p_original_currency is null and coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$')
  then raise exception 'invalid_purchase'; end if;
  -- Не в будущем и не старше года — как у продажи и оплаты.
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
            else jsonb_build_object('occurred_at',p_occurred_at) end)::text);
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
    original_amount,original_currency,fx_rate,occurred_at
  ) values(p_org,p_supplier,'posted',v_amount,p_document,p_idempotency_key,v_hash,
    case when v_converted is null then null else p_original_amount::numeric end,
    case when v_converted is null then null else p_original_currency end,
    case when v_converted is null then null else p_fx_rate::numeric end,
    coalesce(p_occurred_at, now()))
  returning id into v_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,jsonb_build_object('total',v_amount::text));
  return v_purchase;
end
$$;
revoke all on function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz) from public,anon;
grant execute on function public.commit_purchase(uuid,uuid,text,uuid,uuid,text,text,text,timestamptz) to authenticated;

drop function public.commit_sale_items(uuid,uuid,jsonb,boolean,uuid,text);
create function public.commit_sale_items(
  p_org uuid, p_customer uuid, p_lines jsonb, p_paid_immediately boolean,
  p_idempotency_key uuid, p_fx_rate text default null, p_occurred_at timestamptz default null
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
  if p_occurred_at is not null and (
    p_occurred_at > now() + interval '10 minutes' or p_occurred_at < now() - interval '1 year'
  ) then raise exception 'invalid_date'; end if;
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

  v_hash := md5((jsonb_build_object(
    'customer_id',p_customer,'lines',p_lines,'paid_immediately',p_paid_immediately,
    'fx_rate',case when v_foreign then trim_scale(p_fx_rate::numeric)::text end)
    || case when p_occurred_at is null then '{}'::jsonb
            else jsonb_build_object('occurred_at',p_occurred_at) end)::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.sales where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  insert into public.sales(
    organization_id,customer_id,status,total,paid_immediately,idempotency_key,request_hash,
    original_amount,original_currency,fx_rate,occurred_at
  ) values(p_org,p_customer,'posted',v_amount,p_paid_immediately,p_idempotency_key,v_hash,
    case when v_foreign then v_total end,
    case when v_foreign then v_shop_currency end,
    case when v_foreign then p_fx_rate::numeric end,
    coalesce(p_occurred_at, now()))
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
revoke all on function public.commit_sale_items(uuid,uuid,jsonb,boolean,uuid,text,timestamptz) from public,anon;
grant execute on function public.commit_sale_items(uuid,uuid,jsonb,boolean,uuid,text,timestamptz) to authenticated;

drop function public.commit_purchase_items(uuid,uuid,jsonb,uuid,text);
create function public.commit_purchase_items(
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
      update public.products set purchase_price=v_price where organization_id=p_org and id=v_product.id;
    end if;
  end loop;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.posted',v_purchase,
    jsonb_build_object('total',v_amount::text,'lines',v_n));
  return v_purchase;
end
$$;
revoke all on function public.commit_purchase_items(uuid,uuid,jsonb,uuid,text,timestamptz) from public, anon;
grant execute on function public.commit_purchase_items(uuid,uuid,jsonb,uuid,text,timestamptz) to authenticated;

commit;
