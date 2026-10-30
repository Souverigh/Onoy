-- Воронка админки (просьба пользователя 29.10.2026): по каждому, кто сам
-- зарегистрировался (не продавец по приглашению и не админ), — когда прошёл
-- каждый шаг: почта, магазин, первый клиент, первая запись, «активен»
-- (3 записи за 7 дней), оплата. Плюс то, что нужно для «Проблем». Только
-- чтение; данные не меняются, клиенты и суммы не отдаются.
begin;

create function public.admin_funnel() returns table(
  user_id uuid, email text, created_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz,
  org_id uuid, shop_name text, business_type text, shop_created_at timestamptz, phone text,
  customers int, first_customer_at timestamptz, first_record_at timestamptz, last_record_at timestamptz,
  records_7d int, active_at timestamptz, paid_at timestamptz, trial boolean, paid_until date, pending_invites int
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  with shop as (
    -- Магазин владельца — первый созданный им.
    select distinct on (o.created_by) o.*
    from public.organizations o
    order by o.created_by, o.created_at
  ), rec as (
    select r.organization_id, r.created_at from (
      select s.organization_id, s.created_at from public.sales s
      union all select p.organization_id, p.created_at from public.purchases p
      union all select p.organization_id, p.created_at from public.payments p where not p.is_opening
      union all select r.organization_id, r.created_at from public.rentals r
    ) r
  ), active as (
    -- «Активен» впервые: третья запись не позже 7 дней после позапрошлой.
    select x.organization_id, min(x.created_at) as at
    from (
      select rec.organization_id, rec.created_at,
        lag(rec.created_at, 2) over (partition by rec.organization_id order by rec.created_at) as two_before
      from rec
    ) x
    where x.two_before is not null and x.created_at - x.two_before <= interval '7 days'
    group by x.organization_id
  )
  select u.id, u.email::text, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
    sh.id, sh.name, coalesce(sh.business_type, u.raw_user_meta_data->>'business_type'), sh.created_at, sh.phone,
    (select count(*)::int from public.customers c where c.organization_id = sh.id),
    (select min(c.created_at) from public.customers c where c.organization_id = sh.id),
    (select min(r.created_at) from rec r where r.organization_id = sh.id),
    (select max(r.created_at) from rec r where r.organization_id = sh.id),
    (select count(*)::int from rec r where r.organization_id = sh.id and r.created_at > now() - interval '7 days'),
    a.at,
    (select min(t.created_at) from public.audit_events t
      where t.organization_id = sh.id and t.action in ('admin.plan', 'admin.paid')),
    sh.id is not null
      and exists(select 1 from public.audit_events t where t.organization_id = sh.id and t.action = 'organization.created' and (t.metadata->>'trial')::boolean)
      and not exists(select 1 from public.audit_events t where t.organization_id = sh.id and t.action in ('admin.plan', 'admin.paid')),
    sh.paid_until,
    (select count(*)::int from public.organization_invites i
      where i.organization_id = sh.id and i.accepted_at is null and i.revoked_at is null)
  from auth.users u
  left join shop sh on sh.created_by = u.id
  left join active a on a.organization_id = sh.id
  where not exists(select 1 from private.platform_admins p where p.user_id = u.id)
    -- Продавцы по приглашению сами не регистрировались — не в воронке.
    and (sh.id is not null or not exists(select 1 from public.organization_members m where m.user_id = u.id));
end
$$;
revoke all on function public.admin_funnel() from public, anon;
grant execute on function public.admin_funnel() to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261108100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
