-- Кеш каталога (просьба пользователя 22.10.2026): страница каталога
-- собирается один раз и раздаётся из кеша без обращения к базе. Когда в
-- магазине меняют товары (цена, название, фото, архив, импорт), приложение
-- сбрасывает кеш этого каталога — ему нужна ссылка каталога своего магазина.
-- Таблицу ссылок видит только владелец, а товары меняют и продавцы, поэтому —
-- функция для любого участника. Ссылка и так публичная (её рассылают
-- клиентам). Нет включённого каталога — null.
-- Только функция; данные не меняются.
begin;

create function public.get_catalog_token_for_org(p_org uuid) returns text
language sql stable security definer set search_path='' as $$
  select c.token from public.catalog_links c
  where private.is_member(p_org) and c.organization_id = p_org and c.revoked_at is null
$$;
revoke all on function public.get_catalog_token_for_org(uuid) from public, anon;
grant execute on function public.get_catalog_token_for_org(uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022190000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
