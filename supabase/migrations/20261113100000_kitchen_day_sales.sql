-- Кухня, этап 2 (модуль «kitchen», решение пользователя 31.10.2026):
-- «Продажи за день» — сколько каких блюд и товаров продали за день и
-- сколько денег получили (из них переводом). Блюдо списывает со склада
-- продукты по своему составу, товар (Fanta, нан) — сам себя. Одна
-- действующая запись на день; ошиблись — отмена (владелец, с причиной),
-- продукты возвращаются обратными движениями склада.
--
-- Новое: две таблицы, колонка inventory_movements.day_sale_id (пустая у
-- всех существующих движений), вид движения 'kitchen' в проверках склада
-- (ограничения пересоздаются с прежними правилами плюс новое) и две функции.
-- Существующие данные не меняются.
begin;

create table public.day_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  unique (organization_id, id),
  sale_date date not null,
  -- Полдень дня по Бишкеку — для отчётов, которые считают по времени.
  occurred_at timestamptz not null,
  -- Сумма по ценам меню и сколько получили на самом деле (скидки, еда персоналу).
  menu_total numeric(16,2) not null check (menu_total >= 0),
  received numeric(16,2) not null check (received >= 0 and received < 1e14),
  -- Из полученного — переводом или по QR; остальное — наличными в кассу.
  transfer numeric(16,2) not null default 0 check (transfer >= 0 and transfer <= received),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_comment text check (reversal_comment is null or length(reversal_comment) <= 500)
);
create unique index day_sales_org_day_idx on public.day_sales(organization_id, sale_date) where reversed_at is null;
create index day_sales_org_occurred_idx on public.day_sales(organization_id, occurred_at);
alter table public.day_sales enable row level security;
revoke all on public.day_sales from anon, authenticated;
grant select on public.day_sales to authenticated;
create policy member_read on public.day_sales for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.day_sales
  for each row execute function private.reject_blocked_shop();

-- Строка: блюдо или товар склада, сколько продали и по какой цене (цена на тот день).
create table public.day_sale_lines (
  organization_id uuid not null references public.organizations(id),
  day_sale_id uuid not null,
  dish_id uuid,
  product_id uuid,
  qty numeric(13,3) not null check (qty > 0),
  price numeric(16,2) not null check (price >= 0),
  position smallint not null default 0,
  check ((dish_id is null) <> (product_id is null)),
  foreign key (organization_id, day_sale_id) references public.day_sales(organization_id, id),
  foreign key (organization_id, dish_id) references public.dishes(organization_id, id),
  foreign key (organization_id, product_id) references public.products(organization_id, id)
);
create index day_sale_lines_sale_idx on public.day_sale_lines(organization_id, day_sale_id);
alter table public.day_sale_lines enable row level security;
revoke all on public.day_sale_lines from anon, authenticated;
grant select on public.day_sale_lines to authenticated;
create policy member_read on public.day_sale_lines for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.day_sale_lines
  for each row execute function private.reject_blocked_shop();

-- Движения склада продаж за день: списание (−) и возврат при отмене (+).
alter table public.inventory_movements add column day_sale_id uuid;
alter table public.inventory_movements add constraint inventory_movements_day_sale_fk
  foreign key (organization_id, day_sale_id) references public.day_sales(organization_id, id);
create index inventory_movements_day_sale_idx on public.inventory_movements(organization_id, day_sale_id)
  where day_sale_id is not null;
alter table public.inventory_movements drop constraint inventory_movements_reason_check;
alter table public.inventory_movements drop constraint inventory_movements_check;
alter table public.inventory_movements
  add constraint inventory_movements_reason_check
    check (reason in ('purchase','sale','opening','adjustment','receipt','kitchen')),
  add constraint inventory_movements_check check (
    (reason='sale' and sale_id is not null and purchase_id is null and day_sale_id is null and qty_delta<0) or
    (reason='purchase' and purchase_id is not null and sale_id is null and day_sale_id is null and qty_delta>0) or
    (reason='receipt' and purchase_id is null and sale_id is null and day_sale_id is null and qty_delta>0) or
    (reason in ('opening','adjustment') and purchase_id is null and sale_id is null and day_sale_id is null) or
    (reason='kitchen' and day_sale_id is not null and purchase_id is null and sale_id is null));

-- Записать продажи за день. p_lines: [{"dish_id":"…","qty":"42"}, {"product_id":"…","qty":"8"}].
-- Цены — из меню и товаров на сейчас. Списание: блюдо × его состав, товар —
-- сам; объединённый продукт состава — тот, с кем объединили.
create function public.commit_day_sale(
  p_org uuid, p_date date, p_lines jsonb, p_received text, p_transfer text default '0'
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Bishkek')::date;
  v_total numeric;
begin
  perform private.require_member(p_org);
  perform 1 from public.organizations where id = p_org for update;
  if p_date is null or p_date > v_today or p_date < v_today - 366 then raise exception 'invalid_date'; end if;
  if coalesce(p_received, '') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or coalesce(p_transfer, '0') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_amount'; end if;
  if coalesce(p_transfer, '0')::numeric > p_received::numeric then raise exception 'invalid_amount'; end if;

  -- Строки: 1–500, у каждой ровно одно из dish_id / product_id, количество > 0, без повторов.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500
    or exists(
      select 1 from jsonb_array_elements(p_lines) l
      where jsonb_typeof(l) <> 'object'
        or ((l ? 'dish_id') = (l ? 'product_id'))
        or coalesce(l->>'dish_id', l->>'product_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or case when coalesce(l->>'qty', '') ~ '^[0-9]{1,7}(\.[0-9]{1,3})?$' then (l->>'qty')::numeric <= 0 else true end)
    or (select count(distinct coalesce(l->>'dish_id', l->>'product_id')) from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines)
  then raise exception 'invalid_lines'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_lines) l
    where (l ? 'dish_id' and not exists(
        select 1 from public.dishes d where d.organization_id = p_org and d.id = (l->>'dish_id')::uuid and d.archived_at is null))
      or (l ? 'product_id' and not exists(
        select 1 from public.products p where p.organization_id = p_org and p.id = (l->>'product_id')::uuid
          and p.archived_at is null and p.merged_into_id is null)))
  then raise exception 'invalid_item'; end if;
  if exists(select 1 from public.day_sales where organization_id = p_org and sale_date = p_date and reversed_at is null)
  then raise exception 'day_taken'; end if;

  insert into public.day_sales(organization_id, sale_date, occurred_at, menu_total, received, transfer)
  values (p_org, p_date, (p_date::timestamp + interval '12 hours') at time zone 'Asia/Bishkek', 0,
    p_received::numeric, coalesce(p_transfer, '0')::numeric)
  returning id into v_id;

  insert into public.day_sale_lines(organization_id, day_sale_id, dish_id, product_id, qty, price, position)
  select p_org, v_id, (l->>'dish_id')::uuid, (l->>'product_id')::uuid, (l->>'qty')::numeric,
    coalesce(d.price, p.sale_price, 0), (n - 1)::smallint
  from jsonb_array_elements(p_lines) with ordinality as x(l, n)
  left join public.dishes d on d.organization_id = p_org and d.id = (l->>'dish_id')::uuid
  left join public.products p on p.organization_id = p_org and p.id = (l->>'product_id')::uuid;

  select coalesce(sum(round(qty * price, 2)), 0) into v_total
  from public.day_sale_lines where organization_id = p_org and day_sale_id = v_id;
  update public.day_sales set menu_total = v_total where organization_id = p_org and id = v_id;

  insert into public.inventory_movements(organization_id, product_id, qty_delta, reason, day_sale_id, note)
  select p_org, product_id, -round(sum(q), 3), 'kitchen', v_id, 'Продажи за день'
  from (
    select coalesce(pr.merged_into_id, pr.id) as product_id, l.qty * i.qty as q
    from public.day_sale_lines l
    join public.dish_ingredients i on i.organization_id = p_org and i.dish_id = l.dish_id
    join public.products pr on pr.organization_id = p_org and pr.id = i.product_id
    where l.organization_id = p_org and l.day_sale_id = v_id and l.dish_id is not null
    union all
    select l.product_id, l.qty
    from public.day_sale_lines l
    where l.organization_id = p_org and l.day_sale_id = v_id and l.product_id is not null
  ) need
  group by product_id
  having round(sum(q), 3) > 0;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'day_sale.created', v_id, jsonb_build_object(
    'date', p_date, 'menu_total', v_total, 'received', p_received, 'transfer', coalesce(p_transfer, '0'),
    'lines', jsonb_array_length(p_lines)));
  return v_id;
end
$$;
revoke all on function public.commit_day_sale(uuid,date,jsonb,text,text) from public, anon;
grant execute on function public.commit_day_sale(uuid,date,jsonb,text,text) to authenticated;

-- Отменить продажи за день: только владелец, с причиной. Списанное
-- возвращается на склад обратными движениями; запись и история остаются.
create function public.reverse_day_sale(p_org uuid, p_id uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
declare v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  perform private.require_member(p_org);
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if v_comment is null or length(v_comment) > 500 then raise exception 'comment_required'; end if;
  update public.day_sales set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = v_comment
  where organization_id = p_org and id = p_id and reversed_at is null;
  if not found then raise exception 'invalid_day_sale'; end if;
  insert into public.inventory_movements(organization_id, product_id, qty_delta, reason, day_sale_id, note)
  select p_org, product_id, -sum(qty_delta), 'kitchen', p_id, 'Отмена продаж за день'
  from public.inventory_movements
  where organization_id = p_org and day_sale_id = p_id and reason = 'kitchen'
  group by product_id
  having sum(qty_delta) <> 0;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'day_sale.reversed', p_id, jsonb_build_object('comment', v_comment));
end
$$;
revoke all on function public.reverse_day_sale(uuid,uuid,text) from public, anon;
grant execute on function public.reverse_day_sale(uuid,uuid,text) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261113100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
