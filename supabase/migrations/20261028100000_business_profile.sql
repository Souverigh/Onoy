-- Вид бизнеса и модули магазина (решение пользователя 25.10.2026): Depter
-- подстраивается под магазины, кафе, прокат и другие виды — набором модулей
-- (склад, каталог…), а не отдельной веткой кода на каждый вид. Сами виды и
-- модули описаны в коде (src/lib/business/), в базе — только выбор магазина:
--   - business_type: вид бизнеса; null — «Магазин», как было до этой миграции;
--   - module_overrides: поправки владельца к модулям вида: '+rental' включить,
--     '-catalog' выключить; null — ровно по виду. Модуль, который позже
--     добавят в вид, появится у всех магазинов этого вида сам.
-- Выключенный модуль только прячет раздел; данные модуля не трогаются.
-- Только две новые колонки без default: существующие строки не
-- переписываются, у всех магазинов остаётся null — всё как сейчас.
begin;

alter table public.organizations
  add column business_type text
    check (business_type is null or business_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  add column module_overrides text[]
    check (
      module_overrides is null
      or (cardinality(module_overrides) <= 50
        -- null внутри массива превращается в '*' и не проходит шаблон.
        and array_to_string(module_overrides, ',', '*') ~ '^([+-][a-z][a-z0-9_]{0,39}(,|$))*$')
    );

-- Меняет только владелец и только через функцию (с записью в журнал):
-- update на эти колонки напрямую не выдаётся.
create function public.set_business_profile(p_org uuid, p_type text, p_overrides text[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_old_type text; v_old_overrides text[];
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_required'; end if;
  if p_type is not null and p_type !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'invalid_business_type'; end if;
  if p_overrides is not null and (
    cardinality(p_overrides) > 50
    or array_to_string(p_overrides, ',', '*') !~ '^([+-][a-z][a-z0-9_]{0,39}(,|$))*$'
  ) then raise exception 'invalid_modules'; end if;

  select business_type, module_overrides into v_old_type, v_old_overrides
  from public.organizations where id = p_org for update;
  update public.organizations
  set business_type = p_type,
      module_overrides = case when cardinality(p_overrides) = 0 then null else p_overrides end
  where id = p_org;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'organization.business_profile', p_org, jsonb_build_object(
    'from', jsonb_build_object('type', v_old_type, 'modules', to_jsonb(v_old_overrides)),
    'to', jsonb_build_object('type', p_type, 'modules', to_jsonb(p_overrides))));
end
$$;
revoke all on function public.set_business_profile(uuid,text,text[]) from public, anon;
grant execute on function public.set_business_profile(uuid,text,text[]) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261028100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
