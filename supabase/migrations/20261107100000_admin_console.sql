-- Новая админка (просьба пользователя 29.10.2026): вход на /admin со вторым
-- ключом (код из Google Authenticator), список людей и магазинов с контактами
-- и последним действием, страница магазина, заметки «связаться снова»,
-- команда администраторов. Данные магазинов не меняются; клиенты и суммы
-- админке по-прежнему не видны — только счётчики, контакты владельцев и
-- вид действия.
begin;

-- Админ-функции — только после второго ключа (aal2 в токене). Без кода
-- аккаунт лишь узнаёт, что он админ (am_i_platform_admin), — чтобы спросить код.
create or replace function private.is_platform_admin() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  return auth.uid() is not null
    and coalesce(auth.jwt()->>'aal', '') = 'aal2'
    and exists(select 1 from private.platform_admins where user_id = auth.uid());
end
$$;

create or replace function public.am_i_platform_admin() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  return auth.uid() is not null and exists(select 1 from private.platform_admins where user_id = auth.uid());
end
$$;

-- Журнал админов: кого добавили в команду, кого убрали (не про магазины —
-- audit_events требует магазин).
create table private.admin_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_user uuid references auth.users(id),
  metadata jsonb not null default '{}'
);
revoke all on private.admin_events from public, anon, authenticated;
alter table private.admin_events enable row level security;

-- Заметки админов о магазине или о человеке без магазина.
create table private.admin_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  organization_id uuid references public.organizations(id),
  user_id uuid references auth.users(id),
  author_id uuid not null references auth.users(id),
  body text not null check (length(body) between 1 and 2000),
  next_contact date,
  check (organization_id is not null or user_id is not null)
);
create index admin_notes_org on private.admin_notes(organization_id, created_at desc);
create index admin_notes_user on private.admin_notes(user_id, created_at desc);
revoke all on private.admin_notes from public, anon, authenticated;
alter table private.admin_notes enable row level security;

-- Записи магазина (продажи, приход, оплаты, прокат) — для «активен» и воронки.
create function private.shop_records(p_org uuid, p_since timestamptz) returns int
language sql stable security definer set search_path='' as $$
  select (
    (select count(*) from public.sales s where s.organization_id = p_org and s.created_at > p_since)
    + (select count(*) from public.purchases p where p.organization_id = p_org and p.created_at > p_since)
    + (select count(*) from public.payments p where p.organization_id = p_org and p.created_at > p_since and not p.is_opening)
    + (select count(*) from public.rentals r where r.organization_id = p_org and r.created_at > p_since)
  )::int;
$$;
revoke all on function private.shop_records(uuid, timestamptz) from public;

create function private.shop_first_record(p_org uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select least(
    (select min(s.created_at) from public.sales s where s.organization_id = p_org),
    (select min(p.created_at) from public.purchases p where p.organization_id = p_org),
    (select min(p.created_at) from public.payments p where p.organization_id = p_org and not p.is_opening),
    (select min(r.created_at) from public.rentals r where r.organization_id = p_org)
  );
$$;
revoke all on function private.shop_first_record(uuid) from public;

-- Список админки: строка на магазин (владелец — создатель) и строка на
-- аккаунт без магазина. Последнее действие — из журнала участников магазина
-- или вход, что позже; у аккаунта — регистрация, подтверждение почты, вход.
create function public.admin_people() returns table(
  kind text, org_id uuid, user_id uuid, name text, business_type text, email text,
  user_created_at timestamptz, email_confirmed_at timestamptz, shop_created_at timestamptz,
  phone text, seller_name text, plan text, paid_until date, blocked_at timestamptz, trial boolean,
  customers int, records_7d int, first_record_at timestamptz,
  last_action_at timestamptz, last_action text, last_action_role text, last_action_name text,
  next_contact date, last_note text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  with ev as (
    select distinct on (a.organization_id) a.organization_id, a.created_at, a.action, m.role, coalesce(m.display_name, m.email) as who
    from public.audit_events a
    join public.organization_members m on m.organization_id = a.organization_id and m.user_id = a.actor_id
    order by a.organization_id, a.created_at desc
  ), login as (
    select distinct on (m.organization_id) m.organization_id, u.last_sign_in_at, m.role, coalesce(m.display_name, m.email) as who
    from public.organization_members m join auth.users u on u.id = m.user_id
    where u.last_sign_in_at is not null
    order by m.organization_id, u.last_sign_in_at desc
  ), note as (
    select distinct on (coalesce(n.organization_id, n.user_id)) coalesce(n.organization_id, n.user_id) as key, n.next_contact, n.body
    from private.admin_notes n
    order by coalesce(n.organization_id, n.user_id), n.created_at desc
  )
  select 'shop'::text, o.id, o.created_by, o.name, o.business_type, u.email::text,
    u.created_at, u.email_confirmed_at, o.created_at,
    o.phone, o.seller_name, o.plan, o.paid_until, o.blocked_at,
    exists(select 1 from public.audit_events t where t.organization_id = o.id and t.action = 'organization.created' and (t.metadata->>'trial')::boolean)
      and not exists(select 1 from public.audit_events t where t.organization_id = o.id and t.action in ('admin.plan', 'admin.paid')),
    (select count(*)::int from public.customers c where c.organization_id = o.id),
    private.shop_records(o.id, now() - interval '7 days'),
    private.shop_first_record(o.id),
    case when l.last_sign_in_at > coalesce(ev.created_at, '-infinity') then l.last_sign_in_at else ev.created_at end,
    case when l.last_sign_in_at > coalesce(ev.created_at, '-infinity') then 'auth.login' else ev.action end,
    case when l.last_sign_in_at > coalesce(ev.created_at, '-infinity') then l.role else ev.role end,
    case when l.last_sign_in_at > coalesce(ev.created_at, '-infinity') then l.who else ev.who end,
    nt.next_contact, nt.body
  from public.organizations o
  left join auth.users u on u.id = o.created_by
  left join ev on ev.organization_id = o.id
  left join login l on l.organization_id = o.id
  left join note nt on nt.key = o.id
  union all
  select 'account'::text, null::uuid, u.id, null::text, u.raw_user_meta_data->>'business_type', u.email::text,
    u.created_at, u.email_confirmed_at, null::timestamptz,
    null::text, null::text, null::text, null::date, null::timestamptz, null::boolean,
    null::int, null::int, null::timestamptz,
    greatest(u.created_at, u.email_confirmed_at, u.last_sign_in_at),
    case greatest(u.created_at, u.email_confirmed_at, u.last_sign_in_at)
      when u.last_sign_in_at then 'auth.login'
      when u.email_confirmed_at then 'auth.confirmed'
      else 'auth.signup' end,
    'owner'::text, null::text,
    nt.next_contact, nt.body
  from auth.users u
  left join note nt on nt.key = u.id
  where not exists(select 1 from public.organization_members m where m.user_id = u.id)
    and not exists(select 1 from private.platform_admins p where p.user_id = u.id);
end
$$;

-- Страница магазина: участники с почтой и входом, шаги, последние действия
-- (только вид, время и кто), счётчики.
create function public.admin_shop(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  select jsonb_build_object(
    'id', o.id, 'name', o.name, 'business_type', o.business_type, 'created_at', o.created_at,
    'phone', o.phone, 'seller_name', o.seller_name, 'plan', o.plan, 'paid_until', o.paid_until,
    'blocked_at', o.blocked_at, 'blocked_reason', o.blocked_reason,
    'owner_id', o.created_by, 'owner_email', u.email, 'owner_created_at', u.created_at,
    'owner_confirmed_at', u.email_confirmed_at,
    'trial', exists(select 1 from public.audit_events t where t.organization_id = o.id and t.action = 'organization.created' and (t.metadata->>'trial')::boolean)
      and not exists(select 1 from public.audit_events t where t.organization_id = o.id and t.action in ('admin.plan', 'admin.paid')),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'role', m.role, 'name', m.display_name, 'email', coalesce(mu.email, m.email),
        'last_sign_in_at', mu.last_sign_in_at) order by m.role, m.created_at), '[]')
      from public.organization_members m left join auth.users mu on mu.id = m.user_id where m.organization_id = o.id),
    'customers', (select count(*) from public.customers c where c.organization_id = o.id),
    'first_customer_at', (select min(c.created_at) from public.customers c where c.organization_id = o.id),
    'first_record_at', private.shop_first_record(o.id),
    'records_7d', private.shop_records(o.id, now() - interval '7 days'),
    'records_30d', private.shop_records(o.id, now() - interval '30 days'),
    'documents', (select count(*) from public.documents d where d.organization_id = o.id),
    'extractions', (select count(*) from public.document_extractions e where e.organization_id = o.id),
    'gemini_cost', (select coalesce(sum(e.cost), 0) from public.document_extractions e where e.organization_id = o.id),
    'actions', (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
        select * from (
          select a.created_at as at, a.action, m.role, coalesce(m.display_name, m.email) as who
          from public.audit_events a
          join public.organization_members m on m.organization_id = a.organization_id and m.user_id = a.actor_id
          where a.organization_id = o.id
          order by a.created_at desc limit 15
        ) e
        union all
        select mu.last_sign_in_at, 'auth.login', m.role, coalesce(m.display_name, m.email)
        from public.organization_members m join auth.users mu on mu.id = m.user_id
        where m.organization_id = o.id and mu.last_sign_in_at is not null
      ) x)
  ) into v
  from public.organizations o left join auth.users u on u.id = o.created_by
  where o.id = p_org;
  if v is null then raise exception 'invalid_shop'; end if;
  return v;
end
$$;

-- Человек без магазина: почта, регистрация, подтверждение, вход.
create function public.admin_account(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'created_at', u.created_at, 'confirmed_at', u.email_confirmed_at,
    'last_sign_in_at', u.last_sign_in_at, 'business_type', u.raw_user_meta_data->>'business_type',
    'shop_id', (select m.organization_id from public.organization_members m where m.user_id = u.id limit 1)
  ) into v
  from auth.users u where u.id = p_user;
  if v is null then raise exception 'invalid_user'; end if;
  return v;
end
$$;

create function public.admin_notes(p_org uuid, p_user uuid) returns table(
  id uuid, created_at timestamptz, body text, next_contact date, author_email text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select n.id, n.created_at, n.body, n.next_contact, a.email::text
  from private.admin_notes n left join auth.users a on a.id = n.author_id
  where (p_org is not null and n.organization_id = p_org) or (p_org is null and n.user_id = p_user)
  order by n.created_at desc
  limit 50;
end
$$;

create function public.admin_add_note(p_org uuid, p_user uuid, p_body text, p_next date) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_body is null or length(trim(p_body)) not between 1 and 2000 then raise exception 'invalid_note'; end if;
  if (p_org is null) = (p_user is null) then raise exception 'invalid_target'; end if;
  if p_org is not null and not exists(select 1 from public.organizations where id = p_org) then raise exception 'invalid_shop'; end if;
  if p_user is not null and not exists(select 1 from auth.users where id = p_user) then raise exception 'invalid_user'; end if;
  insert into private.admin_notes(organization_id, user_id, author_id, body, next_contact)
  values (p_org, p_user, auth.uid(), trim(p_body), p_next);
end
$$;

-- Вид бизнеса магазина — как set_business_profile у владельца (тот же журнал,
-- владелец увидит «вернуть как было»), но от админа; свои разделы сбрасываются.
create function public.admin_set_business(p_org uuid, p_type text) returns void
language plpgsql security definer set search_path='' as $$
declare v_old_type text; v_old_overrides text[];
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_type is not null and p_type !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'invalid_business_type'; end if;
  select business_type, module_overrides into v_old_type, v_old_overrides
  from public.organizations where id = p_org for update;
  if not found then raise exception 'invalid_shop'; end if;
  update public.organizations set business_type = p_type, module_overrides = null where id = p_org;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'organization.business_profile', p_org, jsonb_build_object(
    'from', jsonb_build_object('type', v_old_type, 'modules', to_jsonb(v_old_overrides)),
    'to', jsonb_build_object('type', p_type, 'modules', null),
    'by_admin', true));
end
$$;

-- «Оплачено до» одной кнопкой: продлить пробный период или отметить оплату.
-- В журнале — что именно сделали: продление не делает магазин «оплатившим».
create function public.admin_extend(p_org uuid, p_paid_until date, p_paid boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_paid_until is null or p_paid is null or p_paid_until < (now() at time zone 'Asia/Bishkek')::date
  then raise exception 'invalid_date'; end if;
  update public.organizations set paid_until = p_paid_until where id = p_org;
  if not found then raise exception 'invalid_shop'; end if;
  insert into public.audit_events(organization_id, actor_id, action, metadata)
  values (p_org, auth.uid(), case when p_paid then 'admin.paid' else 'admin.trial_extended' end,
    jsonb_build_object('paid_until', p_paid_until));
end
$$;

-- Команда: админы, есть ли у них второй ключ, последний вход.
create function public.admin_team() returns table(
  user_id uuid, email text, added_at timestamptz, last_sign_in_at timestamptz, has_mfa boolean
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select p.user_id, u.email::text, p.created_at, u.last_sign_in_at,
    exists(select 1 from auth.mfa_factors f where f.user_id = p.user_id and f.status::text = 'verified')
  from private.platform_admins p join auth.users u on u.id = p.user_id
  order by p.created_at;
end
$$;

-- Новый админ — по email готового аккаунта Depter (сначала регистрируется сам).
create function public.admin_add_admin(p_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then raise exception 'no_account'; end if;
  insert into private.platform_admins(user_id) values (v_user) on conflict do nothing;
  if not found then raise exception 'already_admin'; end if;
  insert into private.admin_events(actor_id, action, target_user) values (auth.uid(), 'admin.added', v_user);
  return v_user;
end
$$;

-- Убрать из команды: только другого — тот, кто убирает, остаётся, так что
-- команда не опустеет.
create function public.admin_remove_admin(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
  delete from private.platform_admins where user_id = p_user;
  if not found then raise exception 'not_admin'; end if;
  insert into private.admin_events(actor_id, action, target_user) values (auth.uid(), 'admin.removed', p_user);
end
$$;

revoke all on function public.admin_people() from public, anon;
revoke all on function public.admin_shop(uuid) from public, anon;
revoke all on function public.admin_account(uuid) from public, anon;
revoke all on function public.admin_notes(uuid, uuid) from public, anon;
revoke all on function public.admin_add_note(uuid, uuid, text, date) from public, anon;
revoke all on function public.admin_set_business(uuid, text) from public, anon;
revoke all on function public.admin_extend(uuid, date, boolean) from public, anon;
revoke all on function public.admin_team() from public, anon;
revoke all on function public.admin_add_admin(text) from public, anon;
revoke all on function public.admin_remove_admin(uuid) from public, anon;
grant execute on function public.admin_people() to authenticated;
grant execute on function public.admin_shop(uuid) to authenticated;
grant execute on function public.admin_account(uuid) to authenticated;
grant execute on function public.admin_notes(uuid, uuid) to authenticated;
grant execute on function public.admin_add_note(uuid, uuid, text, date) to authenticated;
grant execute on function public.admin_set_business(uuid, text) to authenticated;
grant execute on function public.admin_extend(uuid, date, boolean) to authenticated;
grant execute on function public.admin_team() to authenticated;
grant execute on function public.admin_add_admin(text) to authenticated;
grant execute on function public.admin_remove_admin(uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261107100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
