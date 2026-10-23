-- Ссылка на каталог со страницы клиента (просьба пользователя 22.10.2026):
-- если владелец включил каталог, клиент видит «Каталог и цены» на своей
-- странице по ссылке. По ссылке клиента — ссылка каталога его магазина или
-- null (ссылка клиента отозвана, каталог выключен, магазин заблокирован).
-- Только функция; данные не меняются.
begin;

create function public.get_catalog_token_by_link(p_token text) returns text
language sql stable security definer set search_path='' as $$
  select c.token
  from public.share_links l
  join public.catalog_links c on c.organization_id = l.organization_id
  join public.organizations o on o.id = l.organization_id
  where p_token ~ '^[a-f0-9]{32}$' and l.token = p_token and l.revoked_at is null
    and c.revoked_at is null and o.blocked_at is null
$$;
revoke all on function public.get_catalog_token_by_link(text) from public;
grant execute on function public.get_catalog_token_by_link(text) to anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022170000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
