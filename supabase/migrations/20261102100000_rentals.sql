-- Прокат (просьба пользователя 26.10.2026, тетрадь проката одежды): вещи со
-- склада выдают клиенту на несколько дней под залог — документ (паспорт,
-- права…) и по желанию деньги.
--   - деньги за прокат — обычная продажа одной суммой (commit_sale): долг,
--     касса, «Итог дня» и отчёты считают её сами, склад она не списывает;
--   - rentals / rental_items — что на руках, до какого дня, какой залог;
--     вещь на руках не выдать второй раз, пока не вернули (по остатку);
--   - залог деньгами — движение кассы (cash_moves) с rental_id: в «Наличных
--     в кассе» он отдельной строкой «Залоги»; вернули — движение «out»;
--   - возврат позже срока — доплата за лишние дни второй продажей (можно
--     пропустить).
-- Новые таблицы, колонка и функции; существующие данные не меняются.
begin;

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  unique (organization_id, id),
  customer_id uuid not null,
  issued_at timestamptz not null default now(),
  days integer not null check (days between 1 and 365),
  -- Вернуть до (день по Бишкеку): день выдачи + days.
  due_on date not null,
  -- Деньги за прокат и доплата за лишние дни — продажи одной суммой.
  sale_id uuid,
  extra_sale_id uuid,
  -- Залог-документ: паспорт, права, удостоверение, другое; note — чей / что.
  collateral_kind text not null check (collateral_kind in ('passport','license','id_card','other','none')),
  collateral_note text check (collateral_note is null or length(collateral_note) <= 100),
  -- Залог деньгами (в валюте магазина), когда отдали обратно.
  deposit numeric(16,2) check (deposit is null or (deposit > 0 and deposit < 1e14)),
  deposit_returned_at timestamptz,
  note text check (note is null or length(note) <= 500),
  returned_at timestamptz,
  returned_by uuid references auth.users(id),
  idempotency_key uuid not null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_comment text check (reversal_comment is null or length(reversal_comment) <= 500),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  foreign key (organization_id, sale_id) references public.sales(organization_id, id),
  foreign key (organization_id, extra_sale_id) references public.sales(organization_id, id)
);
create index rentals_open_idx on public.rentals(organization_id, due_on) where returned_at is null and reversed_at is null;
create index rentals_customer_idx on public.rentals(organization_id, customer_id, issued_at desc);

-- Вещи выдачи: каждая строка — одна штука товара со склада, цена за сутки.
create table public.rental_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  rental_id uuid not null,
  n integer not null check (n between 1 and 50),
  product_id uuid not null,
  price_per_day numeric(16,2) not null check (price_per_day >= 0 and price_per_day < 1e14),
  returned_at timestamptz,
  returned_by uuid references auth.users(id),
  unique (organization_id, id),
  unique (organization_id, rental_id, n),
  foreign key (organization_id, rental_id) references public.rentals(organization_id, id),
  foreign key (organization_id, product_id) references public.products(organization_id, id)
);
create index rental_items_out_idx on public.rental_items(organization_id, product_id) where returned_at is null;

alter table public.rentals enable row level security;
alter table public.rental_items enable row level security;
revoke all on public.rentals, public.rental_items from anon, authenticated;
grant select on public.rentals, public.rental_items to authenticated;
create policy tenant_read on public.rentals for select to authenticated using (private.is_member(organization_id));
create policy tenant_read on public.rental_items for select to authenticated using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.rentals
  for each row execute function private.reject_blocked_shop();
create trigger reject_blocked_shop before insert or update on public.rental_items
  for each row execute function private.reject_blocked_shop();

-- Залог деньгами в кассе — движение с пометкой выдачи.
alter table public.cash_moves add column rental_id uuid;
alter table public.cash_moves add constraint cash_moves_rental_fkey
  foreign key (organization_id, rental_id) references public.rentals(organization_id, id);

-- Ключ для вложенной записи (продажа, движение кассы) из ключа выдачи.
create function private.rental_key(p_key uuid, p_part text) returns uuid
language sql immutable set search_path='' as $$ select md5(p_key::text || ':' || p_part)::uuid $$;
revoke all on function private.rental_key(uuid,text) from public;

-- Выдать: p_items — [{product, price}] (цена за сутки), p_amount — сумма за
-- весь срок (можно поправить; 0 — бесплатно, без продажи), p_paid — оплатил
-- сейчас. Повтор с тем же ключом — та же выдача.
create function public.issue_rental(
  p_org uuid, p_customer uuid, p_items jsonb, p_days integer, p_amount text, p_paid boolean,
  p_collateral_kind text, p_collateral_note text, p_deposit text, p_note text, p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_item jsonb; v_n integer := 0; v_product uuid; v_amount numeric; v_deposit numeric;
  v_currency text; v_sale uuid; v_names text;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_collateral text := nullif(trim(coalesce(p_collateral_note,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  select id into v_id from public.rentals where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;

  if p_idempotency_key is null or p_customer is null or p_paid is null
    or p_days is null or p_days not between 1 and 365
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or p_collateral_kind is null or p_collateral_kind not in ('passport','license','id_card','other','none')
    or length(coalesce(v_collateral,'')) > 100 or length(coalesce(v_note,'')) > 500
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50
  then raise exception 'invalid_rental'; end if;
  if p_deposit is not null and p_deposit <> '' then
    if p_deposit !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_rental'; end if;
    v_deposit := nullif(p_deposit::numeric, 0);
  end if;
  v_amount := p_amount::numeric;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer and merged_into_id is null)
  then raise exception 'invalid_customer'; end if;
  select coalesce(currency,'KGS') into v_currency from public.organizations where id=p_org;

  insert into public.rentals(
    organization_id, customer_id, days, due_on, collateral_kind, collateral_note, deposit, note, idempotency_key
  ) values (
    p_org, p_customer, p_days, (now() at time zone 'Asia/Bishkek')::date + p_days,
    p_collateral_kind, v_collateral, v_deposit, v_note, p_idempotency_key
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item->>'product','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_item->>'price','') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    then raise exception 'invalid_rental'; end if;
    v_product := (v_item->>'product')::uuid;
    if not exists(select 1 from public.products where organization_id=p_org and id=v_product and archived_at is null)
    then raise exception 'invalid_product'; end if;
    v_n := v_n + 1;
    insert into public.rental_items(organization_id, rental_id, n, product_id, price_per_day)
    values (p_org, v_id, v_n, v_product, (v_item->>'price')::numeric);
  end loop;

  -- Свободно: остаток минус уже на руках (вместе с этой выдачей). Магазин
  -- заблокирован строкой organizations — две выдачи одной вещи не пройдут.
  if exists(
    select 1 from public.rental_items i
    join public.product_balances b on b.organization_id = i.organization_id and b.id = i.product_id
    where i.organization_id = p_org and i.rental_id = v_id
      and b.stock::numeric < (
        select count(*) from public.rental_items o
        join public.rentals r on r.organization_id = o.organization_id and r.id = o.rental_id
        where o.organization_id = p_org and o.product_id = i.product_id
          and o.returned_at is null and r.reversed_at is null)
  ) then raise exception 'item_busy'; end if;

  if v_amount > 0 then
    v_sale := public.commit_sale(p_org, p_customer, v_amount::text, p_paid, private.rental_key(p_idempotency_key, 'sale'));
    select string_agg(p.name, ', ' order by i.n) into v_names
    from public.rental_items i join public.products p on p.organization_id = i.organization_id and p.id = i.product_id
    where i.organization_id = p_org and i.rental_id = v_id;
    update public.sales set note = left('Прокат на ' || p_days || ' дн.: ' || v_names, 500)
    where organization_id = p_org and id = v_sale;
    update public.rentals set sale_id = v_sale where organization_id = p_org and id = v_id;
  end if;
  if v_deposit is not null then
    insert into public.cash_moves(organization_id, direction, amount, currency, note, idempotency_key, rental_id)
    values (p_org, 'in', v_deposit, v_currency, 'Залог за прокат', private.rental_key(p_idempotency_key, 'deposit'), v_id);
  end if;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.issued', v_id, jsonb_build_object(
    'customer', p_customer, 'items', v_n, 'days', p_days, 'amount', v_amount::text,
    'deposit', v_deposit::text, 'collateral', p_collateral_kind));
  return v_id;
end
$$;
revoke all on function public.issue_rental(uuid,uuid,jsonb,integer,text,boolean,text,text,text,text,uuid) from public, anon;
grant execute on function public.issue_rental(uuid,uuid,jsonb,integer,text,boolean,text,text,text,text,uuid) to authenticated;

-- Вернули: p_items — какие вещи (null — все оставшиеся). Вернули последнюю —
-- выдача закрыта: доплата за лишние дни (p_extra > 0, продажей; p_extra_paid —
-- оплатил сейчас) и залог деньгами обратно из кассы (p_deposit_back).
create function public.return_rental(
  p_org uuid, p_rental uuid, p_items uuid[], p_extra text, p_extra_paid boolean, p_deposit_back boolean
) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  v_rental public.rentals; v_count integer; v_extra numeric; v_sale uuid; v_currency text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  select * into v_rental from public.rentals where organization_id=p_org and id=p_rental for update;
  if not found or v_rental.reversed_at is not null then raise exception 'invalid_rental'; end if;
  if v_rental.returned_at is not null then return true; end if;
  if p_extra is not null and p_extra <> '' and p_extra !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_rental'; end if;

  update public.rental_items set returned_at = now(), returned_by = auth.uid()
  where organization_id = p_org and rental_id = p_rental and returned_at is null
    and (p_items is null or id = any(p_items));
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'invalid_rental'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.items_returned', p_rental, jsonb_build_object('items', v_count));

  if exists(select 1 from public.rental_items where organization_id = p_org and rental_id = p_rental and returned_at is null)
  then return false; end if;

  v_extra := nullif(coalesce(nullif(p_extra,''),'0')::numeric, 0);
  if v_extra is not null then
    v_sale := public.commit_sale(p_org, v_rental.customer_id, v_extra::text, coalesce(p_extra_paid, false),
      private.rental_key(v_rental.idempotency_key, 'extra'));
    update public.sales set note = 'Прокат: доплата за лишние дни' where organization_id = p_org and id = v_sale;
  end if;
  if v_rental.deposit is not null and coalesce(p_deposit_back, false) then
    select coalesce(currency,'KGS') into v_currency from public.organizations where id=p_org;
    insert into public.cash_moves(organization_id, direction, amount, currency, note, idempotency_key, rental_id)
    values (p_org, 'out', v_rental.deposit, v_currency, 'Возврат залога за прокат',
      private.rental_key(v_rental.idempotency_key, 'deposit_back'), p_rental);
  end if;
  update public.rentals
  set returned_at = now(), returned_by = auth.uid(), extra_sale_id = v_sale,
      deposit_returned_at = case when deposit is not null and coalesce(p_deposit_back, false) then now() end
  where organization_id = p_org and id = p_rental;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.returned', p_rental, jsonb_build_object(
    'extra', v_extra::text, 'deposit_back', v_rental.deposit is not null and coalesce(p_deposit_back, false)));
  return true;
end
$$;
revoke all on function public.return_rental(uuid,uuid,uuid[],text,boolean,boolean) from public, anon;
grant execute on function public.return_rental(uuid,uuid,uuid[],text,boolean,boolean) to authenticated;

-- Залог деньгами не отдали при возврате — отдать позже.
create function public.return_rental_deposit(p_org uuid, p_rental uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_rental public.rentals; v_currency text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  select * into v_rental from public.rentals where organization_id=p_org and id=p_rental for update;
  if not found or v_rental.reversed_at is not null or v_rental.deposit is null or v_rental.deposit_returned_at is not null
  then raise exception 'invalid_rental'; end if;
  select coalesce(currency,'KGS') into v_currency from public.organizations where id=p_org;
  insert into public.cash_moves(organization_id, direction, amount, currency, note, idempotency_key, rental_id)
  values (p_org, 'out', v_rental.deposit, v_currency, 'Возврат залога за прокат',
    private.rental_key(v_rental.idempotency_key, 'deposit_back'), p_rental);
  update public.rentals set deposit_returned_at = now() where organization_id = p_org and id = p_rental;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.deposit_returned', p_rental, jsonb_build_object('deposit', v_rental.deposit::text));
end
$$;
revoke all on function public.return_rental_deposit(uuid,uuid) from public, anon;
grant execute on function public.return_rental_deposit(uuid,uuid) to authenticated;

-- Отменить выдачу (ошиблись): владелец, с причиной. Продажи отменяются,
-- залог деньгами — тоже (движение кассы отменено), вещи снова свободны.
-- Выдача остаётся в истории отменённой.
create function public.reverse_rental(p_org uuid, p_rental uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
declare v_rental public.rentals; v_comment text := nullif(trim(coalesce(p_comment,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_comment is null or length(v_comment) > 500 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select * into v_rental from public.rentals where organization_id=p_org and id=p_rental for update;
  if not found or v_rental.reversed_at is not null then raise exception 'invalid_rental'; end if;
  update public.sales set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = 'Прокат отменён: ' || v_comment
  where organization_id = p_org and id in (v_rental.sale_id, v_rental.extra_sale_id) and reversed_at is null;
  update public.cash_moves set reversed_at = now(), reversed_by = auth.uid()
  where organization_id = p_org and rental_id = p_rental and reversed_at is null;
  update public.rental_items set returned_at = coalesce(returned_at, now()), returned_by = coalesce(returned_by, auth.uid())
  where organization_id = p_org and rental_id = p_rental;
  update public.rentals set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = v_comment
  where organization_id = p_org and id = p_rental;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.reversed', p_rental, jsonb_build_object('comment', v_comment));
end
$$;
revoke all on function public.reverse_rental(uuid,uuid,text) from public, anon;
grant execute on function public.reverse_rental(uuid,uuid,text) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261102100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
