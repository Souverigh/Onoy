-- Каталог для клиентов магазина (просьба пользователя 22.10.2026): одна
-- ссылка без входа — название магазина, телефон и товары с ценой продажи.
-- Остатков, цен закупки, кодов и других названий в каталоге нет.
--   catalog_links — ссылка магазина; выключить — revoked_at, включить снова —
--                   новая ссылка (старая больше не откроется);
--   products.catalog_hidden — владелец убирает товар из каталога.
-- В каталоге: не в архиве, не скрытые, с ценой продажи больше нуля.
-- Новая таблица, новая колонка с default и функции; данные не меняются.
begin;

alter table public.products add column catalog_hidden boolean not null default false;

create table public.catalog_links (
  organization_id uuid primary key references public.organizations(id),
  token text not null unique default replace(gen_random_uuid()::text,'-',''),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  revoked_at timestamptz
);
alter table public.catalog_links enable row level security;
revoke all on public.catalog_links from anon, authenticated;
grant select on public.catalog_links to authenticated;
create policy owner_read on public.catalog_links for select to authenticated
  using (private.is_owner(organization_id));
create trigger reject_blocked_shop before insert or update on public.catalog_links
  for each row execute function private.reject_blocked_shop();

-- Включить каталог: есть действующая ссылка — она же; выключенной или нет —
-- новая. Только владелец.
create function public.open_catalog_link(p_org uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  insert into public.catalog_links(organization_id) values (p_org)
  on conflict (organization_id) do update
    set token = case when public.catalog_links.revoked_at is null then public.catalog_links.token
                     else replace(gen_random_uuid()::text,'-','') end,
        created_at = case when public.catalog_links.revoked_at is null then public.catalog_links.created_at else now() end,
        created_by = case when public.catalog_links.revoked_at is null then public.catalog_links.created_by else auth.uid() end,
        revoked_at = null
  returning token into v_token;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org, auth.uid(), 'catalog.opened', '{}'::jsonb);
  return v_token;
end
$$;
revoke all on function public.open_catalog_link(uuid) from public, anon;
grant execute on function public.open_catalog_link(uuid) to authenticated;

-- Выключить: ссылка перестаёт открываться. Только владелец.
create function public.close_catalog_link(p_org uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.catalog_links set revoked_at = now()
  where organization_id = p_org and revoked_at is null;
  if not found then raise exception 'invalid_catalog'; end if;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org, auth.uid(), 'catalog.closed', '{}'::jsonb);
end
$$;
revoke all on function public.close_catalog_link(uuid) from public, anon;
grant execute on function public.close_catalog_link(uuid) to authenticated;

-- Какие товары скрыть из каталога: p_hidden — все скрытые (остальные видны).
-- Меняются только товары этого магазина, где отметка правда меняется.
create function public.set_catalog_hidden(p_org uuid, p_hidden uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare v_changed integer;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_hidden is null or cardinality(p_hidden) > 10000 then raise exception 'invalid_catalog'; end if;
  update public.products set catalog_hidden = (id = any(p_hidden))
  where organization_id = p_org and catalog_hidden is distinct from (id = any(p_hidden));
  get diagnostics v_changed = row_count;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org, auth.uid(), 'catalog.products', jsonb_build_object('changed', v_changed, 'hidden', cardinality(p_hidden)));
  return v_changed;
end
$$;
revoke all on function public.set_catalog_hidden(uuid,uuid[]) from public, anon;
grant execute on function public.set_catalog_hidden(uuid,uuid[]) to authenticated;

-- Каталог по ссылке (без входа): магазин и товары. Неверная, выключенная
-- ссылка или магазин заблокирован админом — null.
create function public.get_catalog(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'shop_name', o.name,
    'shop_phone', coalesce(nullif(o.phone, ''), nullif(o.seller_phone, ''), ''),
    'currency', coalesce(o.currency, 'KGS'),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'price', p.sale_price::text)
        order by lower(p.name))
      from public.products p
      where p.organization_id = l.organization_id and p.archived_at is null
        and not p.catalog_hidden and p.sale_price > 0
    ), '[]'::jsonb)
  )
  from public.catalog_links l
  join public.organizations o on o.id = l.organization_id
  where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null and o.blocked_at is null
$$;
revoke all on function public.get_catalog(text) from public;
grant execute on function public.get_catalog(text) to anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022150000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
