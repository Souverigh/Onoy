-- Админ-панель Depter (решение пользователя 27.09.2026): коды доступа, обзор
-- магазинов, блокировка, тариф и «оплачено до». Администратор платформы — не
-- участник магазинов: денежные данные магазинов (клиенты, долги) ему не
-- видны, только сводные счётчики. Назначается в SQL Editor:
--   insert into private.platform_admins(user_id)
--   select id from auth.users where email = 'souverigh@gmail.com';
-- Существующие магазины: тариф 'basic', не заблокированы — данные не меняются.
begin;

create table private.platform_admins (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
revoke all on private.platform_admins from public, anon, authenticated;
-- RLS без политик — ещё один замок: читают только security definer функции
-- (для владельца таблицы RLS не действует).
alter table private.platform_admins enable row level security;

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.platform_admins where user_id=auth.uid());
$$;
revoke all on function private.is_platform_admin() from public;
grant execute on function private.is_platform_admin() to authenticated;

create function public.am_i_platform_admin() returns boolean
language sql stable security definer set search_path='' as $$ select private.is_platform_admin(); $$;
revoke all on function public.am_i_platform_admin() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;

-- Тариф, оплата, блокировка. Меняет только админ (через RPC ниже).
alter table public.organizations
  add column plan text not null default 'basic' check (plan in ('basic','business')),
  add column paid_until date,
  add column blocked_at timestamptz,
  add column blocked_reason text check (blocked_reason is null or length(blocked_reason) <= 300);

-- Заблокированный магазин: читать можно, вносить и менять — нет. Один
-- триггер на все таблицы данных магазина — срабатывает и внутри RPC.
create function private.reject_blocked_shop() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.organizations where id=new.organization_id and blocked_at is not null)
  then raise exception 'shop_blocked'; end if;
  return new;
end
$$;
do $$
declare t text;
begin
  foreach t in array array[
    'customers','suppliers','products','sales','purchases','payments','documents','document_lines',
    'document_extractions','document_pages','share_links','day_closures','organization_invites'
  ] loop
    execute format(
      'create trigger reject_blocked_shop before insert or update on public.%I for each row execute function private.reject_blocked_shop()',
      t);
  end loop;
end
$$;

-- «Бизнес»: сотрудники только на этом тарифе (уже вступившие остаются).
-- Тело — как в staff_roles.sql, плюс проверка тарифа.
create or replace function public.create_invite(p_org uuid, p_name text) returns text
language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if (select plan from public.organizations where id=p_org) is distinct from 'business'
  then raise exception 'business_plan'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if (select count(*) from public.organization_members where organization_id=p_org and role='staff')
     + (select count(*) from public.organization_invites
        where organization_id=p_org and accepted_at is null and revoked_at is null and expires_at > now()) >= 5
  then raise exception 'staff_limit'; end if;
  insert into public.organization_invites(organization_id,display_name,created_by)
  values(p_org,trim(p_name),auth.uid()) returning token into v_token;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'member.invited',jsonb_build_object('name',trim(p_name)));
  return v_token;
end
$$;

-- Страница клиента и PDF по ссылке у заблокированного магазина не открываются.
create function private.shop_blocked_by_token(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.share_links l join public.organizations o on o.id=l.organization_id
    where l.token=p_token and o.blocked_at is not null
  );
$$;
revoke all on function private.shop_blocked_by_token(text) from public;

-- Обёртки над страницами по ссылке: тела get_statement_by_token и
-- get_invoice_by_token не копируем — переименовываем и проверяем блокировку.
alter function public.get_statement_by_token(text) rename to get_statement_by_token_unchecked;
alter function public.get_invoice_by_token(text,uuid) rename to get_invoice_by_token_unchecked;
alter function public.get_statement_by_token_unchecked(text) set schema private;
alter function public.get_invoice_by_token_unchecked(text,uuid) set schema private;
revoke all on function private.get_statement_by_token_unchecked(text) from public, anon, authenticated;
revoke all on function private.get_invoice_by_token_unchecked(text,uuid) from public, anon, authenticated;

create function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if private.shop_blocked_by_token(p_token) then raise exception 'shop_blocked'; end if;
  return private.get_statement_by_token_unchecked(p_token);
end
$$;
create function public.get_invoice_by_token(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if private.shop_blocked_by_token(p_token) then raise exception 'shop_blocked'; end if;
  return private.get_invoice_by_token_unchecked(p_token, p_sale);
end
$$;
revoke all on function public.get_statement_by_token(text) from public;
revoke all on function public.get_invoice_by_token(text,uuid) from public;
grant execute on function public.get_statement_by_token(text) to anon, authenticated;
grant execute on function public.get_invoice_by_token(text,uuid) to anon, authenticated;

-- --- RPC админки ---------------------------------------------------------

-- Магазины: только счётчики и служебные данные, без клиентов и сумм долгов.
create function public.admin_shops() returns table(
  id uuid, name text, created_at timestamptz, owner_email text, plan text, paid_until date,
  blocked_at timestamptz, blocked_reason text, members int, staff int, customers int,
  records_7d int, records_30d int, last_activity timestamptz, gemini_cost numeric, signup_code text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select o.id, o.name, o.created_at,
    (select u.email::text from auth.users u where u.id=o.created_by),
    o.plan, o.paid_until, o.blocked_at, o.blocked_reason,
    (select count(*)::int from public.organization_members m where m.organization_id=o.id),
    (select count(*)::int from public.organization_members m where m.organization_id=o.id and m.role='staff'),
    (select count(*)::int from public.customers c where c.organization_id=o.id),
    (select (
      (select count(*) from public.sales s where s.organization_id=o.id and s.created_at > now()-interval '7 days')
      + (select count(*) from public.purchases p where p.organization_id=o.id and p.created_at > now()-interval '7 days')
      + (select count(*) from public.payments p where p.organization_id=o.id and p.created_at > now()-interval '7 days' and not p.is_opening)
    )::int),
    (select (
      (select count(*) from public.sales s where s.organization_id=o.id and s.created_at > now()-interval '30 days')
      + (select count(*) from public.purchases p where p.organization_id=o.id and p.created_at > now()-interval '30 days')
      + (select count(*) from public.payments p where p.organization_id=o.id and p.created_at > now()-interval '30 days' and not p.is_opening)
    )::int),
    (select max(a.created_at) from public.audit_events a where a.organization_id=o.id),
    (select coalesce(sum(e.cost),0) from public.document_extractions e where e.organization_id=o.id),
    (select c.code from private.shop_signup_codes c where c.organization_id=o.id limit 1)
  from public.organizations o
  order by o.created_at desc;
end
$$;

create function public.admin_codes() returns table(
  code text, note text, created_at timestamptz, used_at timestamptz, organization_id uuid, shop_name text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select c.code, c.note, c.created_at, c.used_at, c.organization_id, o.name
  from private.shop_signup_codes c left join public.organizations o on o.id=c.organization_id
  order by c.used_at is not null, c.created_at desc;
end
$$;

create function public.admin_create_code(p_note text) returns text
language plpgsql security definer set search_path='' as $$
declare v_code text;
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 200 then raise exception 'invalid_note'; end if;
  insert into private.shop_signup_codes(note) values(trim(p_note)) returning code into v_code;
  return v_code;
end
$$;

-- Отменить можно только неиспользованный код (история использованных остаётся).
create function public.admin_delete_code(p_code text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  delete from private.shop_signup_codes where code=p_code and used_at is null;
  if not found then raise exception 'invalid_code'; end if;
end
$$;

create function public.admin_set_plan(p_org uuid, p_plan text, p_paid_until date) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_plan not in ('basic','business') then raise exception 'invalid_plan'; end if;
  update public.organizations set plan=p_plan, paid_until=p_paid_until where id=p_org;
  if not found then raise exception 'invalid_shop'; end if;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'admin.plan',jsonb_build_object('plan',p_plan,'paid_until',p_paid_until));
end
$$;

create function public.admin_set_blocked(p_org uuid, p_blocked boolean, p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_blocked and (p_reason is null or length(trim(p_reason)) not between 1 and 300) then raise exception 'invalid_reason'; end if;
  update public.organizations
  set blocked_at=case when p_blocked then now() end,
      blocked_reason=case when p_blocked then trim(p_reason) end
  where id=p_org;
  if not found then raise exception 'invalid_shop'; end if;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),case when p_blocked then 'admin.blocked' else 'admin.unblocked' end,
    jsonb_build_object('reason',p_reason));
end
$$;

revoke all on function public.admin_shops() from public, anon;
revoke all on function public.admin_codes() from public, anon;
revoke all on function public.admin_create_code(text) from public, anon;
revoke all on function public.admin_delete_code(text) from public, anon;
revoke all on function public.admin_set_plan(uuid,text,date) from public, anon;
revoke all on function public.admin_set_blocked(uuid,boolean,text) from public, anon;
grant execute on function public.admin_shops() to authenticated;
grant execute on function public.admin_codes() to authenticated;
grant execute on function public.admin_create_code(text) to authenticated;
grant execute on function public.admin_delete_code(text) to authenticated;
grant execute on function public.admin_set_plan(uuid,text,date) to authenticated;
grant execute on function public.admin_set_blocked(uuid,boolean,text) to authenticated;

commit;
