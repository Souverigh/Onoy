-- Перенос тетради (ТЗ §2, Этап 1): стартовые долги клиентов и поставщиков.
-- Начальный долг — обычная запись журнала с пометкой is_opening: для клиента
-- это продажа, для поставщика — приход, аванс (отрицательный долг) — оплата.
-- Так баланс, акт сверки, страница клиента и отмена работают без изменений;
-- «Итог дня» такие записи не считает продажами и оплатами дня.
-- Существующие записи не меняются: у них is_opening=false (значение по умолчанию).
begin;

alter table public.sales add column is_opening boolean not null default false;
alter table public.purchases add column is_opening boolean not null default false;
alter table public.payments add column is_opening boolean not null default false;

-- Один перенос на контрагента: второй раз ту же тетрадь не внести, пока
-- первый не отменён.
create unique index sales_opening_once on public.sales(organization_id, customer_id)
  where is_opening and reversed_at is null;
create unique index purchases_opening_once on public.purchases(organization_id, supplier_id)
  where is_opening and reversed_at is null;
create unique index payments_opening_customer_once on public.payments(organization_id, customer_id)
  where is_opening and reversed_at is null and customer_id is not null;
create unique index payments_opening_supplier_once on public.payments(organization_id, supplier_id)
  where is_opening and reversed_at is null and supplier_id is not null;

create function private.has_opening(p_org uuid, p_kind text, p_party uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_kind='customer' then
      exists(select 1 from public.sales where organization_id=p_org and customer_id=p_party
               and is_opening and reversed_at is null)
      or exists(select 1 from public.payments where organization_id=p_org and customer_id=p_party
               and is_opening and reversed_at is null)
    else
      exists(select 1 from public.purchases where organization_id=p_org and supplier_id=p_party
               and is_opening and reversed_at is null)
      or exists(select 1 from public.payments where organization_id=p_org and supplier_id=p_party
               and is_opening and reversed_at is null)
    end;
$$;
revoke all on function private.has_opening(uuid,text,uuid) from public,anon,authenticated;

-- Одна строка тетради: контрагент (существующий по id, по имени без учёта
-- регистра, либо новый) + сумма со знаком. Возвращает id контрагента.
-- Идемпотентно по p_idempotency_key: повтор после сбоя ничего не задвоит.
create function public.import_opening_balance(
  p_org uuid, p_kind text, p_party uuid, p_name text, p_phone text, p_amount text,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_party uuid; v_amount numeric; v_name text; v_phone text; v_hash text; v_existing_hash text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('customer','supplier') or p_idempotency_key is null
    or coalesce(p_amount,'') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_opening'; end if;
  v_amount := p_amount::numeric;
  if v_amount=0 or abs(v_amount)>=100000000000000 then raise exception 'invalid_opening'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  v_name := trim(coalesce(p_name,''));
  v_phone := left(trim(coalesce(p_phone,'')),40);
  v_hash := md5(jsonb_build_object('kind',p_kind,'party',p_party,'name',v_name,'amount',v_amount::text)::text);

  -- Повтор той же строки (тот же ключ) — возвращаем уже созданное.
  select request_hash, coalesce(customer_id, supplier_id) into v_existing_hash, v_party from (
    select request_hash, customer_id, null::uuid as supplier_id from public.sales
      where organization_id=p_org and idempotency_key=p_idempotency_key
    union all
    select request_hash, null, supplier_id from public.purchases
      where organization_id=p_org and idempotency_key=p_idempotency_key
    union all
    select request_hash, customer_id, supplier_id from public.payments
      where organization_id=p_org and idempotency_key=p_idempotency_key
  ) prior limit 1;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_party;
  end if;

  if p_party is not null then
    if p_kind='customer' then
      select id into v_party from public.customers where organization_id=p_org and id=p_party;
    else
      select id into v_party from public.suppliers where organization_id=p_org and id=p_party;
    end if;
    if v_party is null then raise exception 'invalid_party'; end if;
  else
    if length(v_name) not between 1 and 160 then raise exception 'invalid_opening'; end if;
    if p_kind='customer' then
      select id into v_party from public.customers
        where organization_id=p_org and lower(name)=lower(v_name) order by created_at limit 1;
      if v_party is null then
        insert into public.customers(organization_id,name,phone) values(p_org,v_name,v_phone)
        returning id into v_party;
      end if;
    else
      select id into v_party from public.suppliers
        where organization_id=p_org and lower(name)=lower(v_name) order by created_at limit 1;
      if v_party is null then
        insert into public.suppliers(organization_id,name,phone) values(p_org,v_name,v_phone)
        returning id into v_party;
      end if;
    end if;
  end if;

  if private.has_opening(p_org,p_kind,v_party) then raise exception 'opening_exists'; end if;

  if v_amount>0 and p_kind='customer' then
    insert into public.sales(organization_id,customer_id,status,total,paid_immediately,is_opening,idempotency_key,request_hash)
    values(p_org,v_party,'posted',v_amount,false,true,p_idempotency_key,v_hash);
  elsif v_amount>0 then
    insert into public.purchases(organization_id,supplier_id,status,total,is_opening,idempotency_key,request_hash)
    values(p_org,v_party,'posted',v_amount,true,p_idempotency_key,v_hash);
  else
    -- Аванс: контрагент заплатил больше, чем должен (или магазин переплатил поставщику).
    insert into public.payments(organization_id,customer_id,supplier_id,direction,amount,status,is_opening,idempotency_key,request_hash)
    values(p_org,
      case when p_kind='customer' then v_party end,
      case when p_kind='supplier' then v_party end,
      case when p_kind='customer' then 'incoming' else 'outgoing' end,
      -v_amount,'confirmed',true,p_idempotency_key,v_hash);
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'opening.imported',v_party,
    jsonb_build_object('kind',p_kind,'amount',v_amount::text));
  return v_party;
end
$$;
revoke all on function public.import_opening_balance(uuid,text,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.import_opening_balance(uuid,text,uuid,text,text,text,uuid) to authenticated;

-- Страница клиента по ссылке: те же данные + пометка opening, чтобы клиент
-- видел «Долг из тетради», а не «Продажа». Тело — как в debt_ledger.sql.
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_shop_name text; v_shop_phone text; v_balance text;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select l.*, c.name as customer_name, c.phone as customer_phone
  into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  select o.name, o.phone into v_shop_name, v_shop_phone from public.organizations o where o.id=v_link.organization_id;
  select balance into v_balance from public.customer_balances
  where organization_id=v_link.organization_id and id=v_link.customer_id;
  return jsonb_build_object(
    'shop_name', v_shop_name,
    'shop_phone', v_shop_phone,
    'customer_name', v_link.customer_name,
    'balance', coalesce(v_balance,'0'),
    'entries', (
      select coalesce(jsonb_agg(entry order by entry->>'occurred_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('kind','sale','id',id,'amount',total::text,
          'occurred_at',occurred_at,'reversed',reversed_at is not null,'paid_immediately',paid_immediately,
          'opening',is_opening) as entry
        from public.sales where organization_id=v_link.organization_id and customer_id=v_link.customer_id and status='posted'
        union all
        select jsonb_build_object('kind','payment','id',id,'amount',amount::text,
          'occurred_at',occurred_at,'reversed',reversed_at is not null,'status',status,
          'opening',is_opening) as entry
        from public.payments where organization_id=v_link.organization_id and customer_id=v_link.customer_id
      ) rows
    )
  );
end
$$;

commit;
