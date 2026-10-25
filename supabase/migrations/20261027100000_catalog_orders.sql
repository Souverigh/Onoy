-- Заказ из каталога сохраняется в Depter (задача № 12, «Задачи Ержану»,
-- 25.10.2026). Раньше «Мой список» уходил только сообщением в WhatsApp и
-- нигде не оставался. Теперь:
--   - клиент по ссылке каталога (без входа) отправляет заказ: товары с
--     количеством, имя и телефон (с личной страницы клиента — без них: заказ
--     сразу его); цены берёт база из склада, не из браузера;
--   - магазин видит заказы в разделе «Заказы», «Сделать продажу» открывает
--     черновик продажи с этими товарами; записали продажу — заказ «Продан»;
--   - «Убрать» — заказ не нужен (можно «Вернуть»);
--   - клиент видит «Мои заказы» со статусом: в каталоге и на своей странице.
-- Новая таблица и функции; существующие данные не меняются.
begin;

create table public.catalog_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Заказ с личной страницы клиента — сразу его; из общего каталога — null.
  customer_id uuid,
  buyer_name text check (buyer_name is null or length(buyer_name) <= 100),
  buyer_phone text check (buyer_phone is null or length(buyer_phone) <= 40),
  note text check (note is null or length(note) <= 1000),
  -- Снимок строк на момент заказа: product_id, name, unit, qty, price (текстом).
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 200),
  total numeric(16,2) not null check (total >= 0 and total < 1e14),
  status text not null default 'new' check (status in ('new','accepted','sold','dismissed')),
  -- «Сделать продажу»: черновик, кто и когда; записали — продажа.
  draft_id uuid,
  sale_id uuid,
  handled_by uuid references auth.users(id),
  handled_at timestamptz,
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  foreign key (organization_id, sale_id) references public.sales(organization_id, id)
);
create index catalog_orders_status_idx on public.catalog_orders(organization_id, status, created_at desc);
create index catalog_orders_draft_idx on public.catalog_orders(organization_id, draft_id) where draft_id is not null;
alter table public.catalog_orders enable row level security;
revoke all on public.catalog_orders from anon, authenticated;
grant select on public.catalog_orders to authenticated;
-- Заказы видят все в магазине: продажу по заказу делает и продавец.
create policy member_read on public.catalog_orders for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.catalog_orders
  for each row execute function private.reject_blocked_shop();

-- Отправить заказ по ссылке каталога (без входа). p_items — [{id, qty}];
-- p_client — ссылка личной страницы клиента этого же магазина (тогда имя и
-- телефон не нужны). Товар пропал из каталога — 'order_changed' (клиент
-- обновит страницу). Не больше 30 заказов в час и 200 необработанных на
-- магазин — ссылку могут переслать кому угодно.
create function public.submit_catalog_order(
  p_token text, p_items jsonb, p_name text, p_phone text, p_note text, p_client text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_org uuid; v_customer uuid; v_name text; v_phone text; v_note text;
  v_items jsonb; v_total numeric; v_count integer; v_id uuid;
begin
  select l.organization_id into v_org
  from public.catalog_links l
  join public.organizations o on o.id = l.organization_id
  where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and o.blocked_at is null;
  if v_org is null then raise exception 'invalid_catalog'; end if;

  if p_client ~ '^[a-f0-9]{32}$' then
    select customer_id into v_customer from public.share_links
    where token = p_client and revoked_at is null and organization_id = v_org;
  end if;
  v_name := nullif(left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 100), '');
  v_phone := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_note := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  if v_customer is null and v_phone is null then raise exception 'phone_required'; end if;
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) not between 6 and 15 then
    raise exception 'invalid_phone';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200
    or exists(
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e) <> 'object'
        or coalesce(e->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        -- case — чтобы мусор («abc») не дошёл до приведения к числу.
        or case when coalesce(e->>'qty', '') ~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then (e->>'qty')::numeric <= 0 else true end
    )
    or (select count(distinct e->>'id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items)
  then raise exception 'invalid_order'; end if;

  select jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'name', p.name, 'unit', p.unit,
           'qty', ((e.value->>'qty')::numeric)::text, 'price', p.sale_price::text) order by e.n),
         sum(round((e.value->>'qty')::numeric * p.sale_price, 2)),
         count(*)
    into v_items, v_total, v_count
  from jsonb_array_elements(p_items) with ordinality as e(value, n)
  join public.products p on p.organization_id = v_org and p.id = (e.value->>'id')::uuid
    and p.archived_at is null and not p.catalog_hidden and p.sale_price > 0;
  if v_count is distinct from jsonb_array_length(p_items) then raise exception 'order_changed'; end if;
  if v_total >= 1e14 then raise exception 'invalid_order'; end if;

  if (select count(*) from public.catalog_orders where organization_id = v_org and created_at > now() - interval '1 hour') >= 30
    or (select count(*) from public.catalog_orders where organization_id = v_org and status = 'new') >= 200
  then raise exception 'too_many_orders'; end if;

  insert into public.catalog_orders(organization_id, customer_id, buyer_name, buyer_phone, note, items, total)
  values (v_org, v_customer, v_name, v_phone, v_note, v_items, v_total)
  returning id into v_id;
  insert into public.audit_events(organization_id, action, entity_id, metadata)
  values (v_org, 'catalog_order.submitted', v_id,
    jsonb_build_object('total', v_total::text, 'lines', v_count, 'customer', v_customer));
  return v_id;
end
$$;
revoke all on function public.submit_catalog_order(text,jsonb,text,text,text,text) from public;
grant execute on function public.submit_catalog_order(text,jsonb,text,text,text,text) to anon, authenticated;

-- «Сделать продажу»: заказ ведёт на черновик продажи (свой, этого магазина).
-- Новый заказ или начатый раньше (черновик стёрли, начали заново) — можно;
-- проданный и убранный — 'order_handled'. Начатый другим человеком, пока его
-- черновик жив, — 'order_in_progress': иначе его запись не отметит заказ и
-- заказ продадут дважды. Забытый черновик освобождает «Убрать» → «Вернуть».
create function public.accept_catalog_order(p_org uuid, p_id uuid, p_draft uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  if not exists(
    select 1 from public.record_drafts
    where organization_id = p_org and id = p_draft and created_by = auth.uid() and kind = 'sale'
  ) then raise exception 'invalid_draft'; end if;
  if exists(
    select 1 from public.catalog_orders o
    join public.record_drafts d on d.organization_id = o.organization_id and d.id = o.draft_id
    where o.organization_id = p_org and o.id = p_id and o.status = 'accepted' and d.created_by <> auth.uid()
  ) then raise exception 'order_in_progress'; end if;
  update public.catalog_orders
  set status = 'accepted', draft_id = p_draft, handled_by = auth.uid(), handled_at = now()
  where organization_id = p_org and id = p_id and status in ('new', 'accepted');
  if not found then raise exception 'order_handled'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'catalog_order.accepted', p_id, jsonb_build_object('draft', p_draft));
end
$$;
revoke all on function public.accept_catalog_order(uuid,uuid,uuid) from public, anon;
grant execute on function public.accept_catalog_order(uuid,uuid,uuid) to authenticated;

-- Записали продажу по черновику заказа — заказ «Продан» (и если его успели
-- «Убрать», пока продавец заполнял форму: продажа всё-таки была). Черновик
-- не от заказа — ничего не происходит (false).
create function public.complete_catalog_order(p_org uuid, p_draft uuid, p_sale uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  if not exists(
    select 1 from public.sales
    where organization_id = p_org and id = p_sale and status = 'posted' and reversed_at is null
  ) then raise exception 'invalid_sale'; end if;
  update public.catalog_orders
  set status = 'sold', sale_id = p_sale, handled_by = auth.uid(), handled_at = now()
  where organization_id = p_org and draft_id = p_draft and status in ('accepted', 'dismissed')
  returning id into v_id;
  if v_id is null then return false; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'catalog_order.sold', v_id, jsonb_build_object('sale', p_sale));
  return true;
end
$$;
revoke all on function public.complete_catalog_order(uuid,uuid,uuid) from public, anon;
grant execute on function public.complete_catalog_order(uuid,uuid,uuid) to authenticated;

-- «Убрать» заказ (не нужен, ошибся, спам) и «Вернуть» убранный в новые.
-- Проданный не трогается.
create function public.set_catalog_order_dismissed(p_org uuid, p_id uuid, p_dismissed boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  if p_dismissed is null then raise exception 'invalid_order'; end if;
  update public.catalog_orders
  set status = case when p_dismissed then 'dismissed' else 'new' end,
      draft_id = case when p_dismissed then draft_id else null end,
      handled_by = auth.uid(), handled_at = now()
  where organization_id = p_org and id = p_id
    and ((p_dismissed and status in ('new', 'accepted')) or (not p_dismissed and status = 'dismissed'));
  if not found then raise exception 'order_handled'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), case when p_dismissed then 'catalog_order.dismissed' else 'catalog_order.restored' end, p_id, '{}'::jsonb);
end
$$;
revoke all on function public.set_catalog_order_dismissed(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_catalog_order_dismissed(uuid,uuid,boolean) to authenticated;

-- «Мои заказы» для клиента (без входа): что заказывал и что с заказом.
-- Только товары, суммы и статус — ни телефона, ни имени, ни комментария.
create function private.client_order_json(o public.catalog_orders) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id', o.id, 'created_at', o.created_at, 'status', o.status, 'total', o.total::text,
    'items', (select jsonb_agg(jsonb_build_object('name', i->>'name', 'unit', i->>'unit', 'qty', i->>'qty', 'price', i->>'price'))
              from jsonb_array_elements(o.items) i))
$$;
revoke all on function private.client_order_json(public.catalog_orders) from public;

-- Из общего каталога: браузер помнит номера своих заказов (до 20); номер —
-- случайный uuid, чужой не угадать. Только заказы магазина этого каталога.
create function public.get_catalog_orders(p_token text, p_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(private.client_order_json(o) order by o.created_at desc), '[]'::jsonb)
  from public.catalog_links l
  join public.organizations o2 on o2.id = l.organization_id
  join public.catalog_orders o on o.organization_id = l.organization_id and o.id = any(p_ids[1:20])
  where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and o2.blocked_at is null
$$;
revoke all on function public.get_catalog_orders(text,uuid[]) from public;
grant execute on function public.get_catalog_orders(text,uuid[]) to anon, authenticated;

-- С личной страницы клиента: его последние 20 заказов — отправленные с его
-- страницы и те, что магазин записал продажей на него; у проданного —
-- продажа (накладная на его странице).
create function public.get_client_orders(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
  from (
    -- Цены каталога — в валюте магазина (у клиента долг может быть в другой).
    select private.client_order_json(o) || jsonb_build_object('sale_id', s.id, 'currency', coalesce(org.currency, 'KGS')) as j,
      o.created_at
    from public.share_links l
    join public.organizations org on org.id = l.organization_id
    join public.catalog_orders o on o.organization_id = l.organization_id
    left join public.sales s on s.organization_id = o.organization_id and s.id = o.sale_id
      and s.customer_id = l.customer_id and s.reversed_at is null
    where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and org.blocked_at is null
      and (o.customer_id = l.customer_id or s.id is not null)
    order by o.created_at desc
    limit 20
  ) x
$$;
revoke all on function public.get_client_orders(text) from public;
grant execute on function public.get_client_orders(text) to anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261027100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
