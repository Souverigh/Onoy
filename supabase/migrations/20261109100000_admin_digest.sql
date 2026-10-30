-- Утренняя сводка админам в Telegram (просьба пользователя 29.10.2026):
-- задача по расписанию на Vercel читает admin_people и admin_funnel
-- серверным ключом Supabase (роль service_role — без входа и без второго
-- ключа). Этот ключ и так обходит все ограничения базы, поэтому ничего
-- нового он не открывает; обычный вход по-прежнему требует aal2. Данные не
-- меняются.
begin;

create or replace function private.is_platform_admin() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  return coalesce(auth.jwt()->>'role', '') = 'service_role'
    or (auth.uid() is not null
      and coalesce(auth.jwt()->>'aal', '') = 'aal2'
      and exists(select 1 from private.platform_admins where user_id = auth.uid()));
end
$$;

grant execute on function public.admin_people() to service_role;
grant execute on function public.admin_funnel() to service_role;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261109100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
