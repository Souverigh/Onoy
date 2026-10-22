-- Версия схемы базы для проверки перед выкладкой (просьба пользователя
-- 21.10.2026): сборка на Vercel (scripts/check-migrations.mjs) спрашивает у
-- базы номер последней применённой миграции и не выкладывает код, если в нём
-- есть миграция новее — код рассчитан на то, что она уже в базе.
-- Каждая новая миграция пересоздаёт эту функцию со своим номером (проверяет
-- tests/migration-safety.test.mjs). Номер — не секрет: читать может и анонимный
-- ключ сборки. Данные не меняются — только функция.
begin;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261021120000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
