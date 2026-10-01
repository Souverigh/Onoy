-- Сколько продавцов можно пригласить — по тарифу (решение пользователя
-- 30.09.2026: «Базовый» — 5, «Бизнес» — 20; числа ещё могут поменяться).
-- Лимит считается как раньше: продавцы + действующие приглашения.
-- Поменять лимит (без деплоя, в SQL Editor):
--   update public.plan_limits set max_staff = 10 where plan = 'basic';
-- Уже вступившие продавцы при уменьшении лимита остаются — нельзя только
-- приглашать новых.
create table public.plan_limits (
  plan text primary key check (plan in ('basic','business')),
  max_staff integer not null check (max_staff between 0 and 1000)
);
insert into public.plan_limits(plan, max_staff) values ('basic', 5), ('business', 20);

-- Читают все вошедшие (настройки показывают «1 из 5»); менять — только SQL.
alter table public.plan_limits enable row level security;
create policy "anyone signed in reads plan limits" on public.plan_limits
  for select to authenticated using (true);
revoke all on public.plan_limits from public, anon, authenticated;
grant select on public.plan_limits to authenticated;

-- Тело — как в platform_admin.sql, но без «только Бизнес»: лимит из plan_limits.
create or replace function public.create_invite(p_org uuid, p_name text) returns text
language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if (select count(*) from public.organization_members where organization_id=p_org and role='staff')
     + (select count(*) from public.organization_invites
        where organization_id=p_org and accepted_at is null and revoked_at is null and expires_at > now())
     >= coalesce((select l.max_staff from public.organizations o
                  join public.plan_limits l on l.plan=o.plan where o.id=p_org), 0)
  then raise exception 'staff_limit'; end if;
  insert into public.organization_invites(organization_id,display_name,created_by)
  values(p_org,trim(p_name),auth.uid()) returning token into v_token;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'member.invited',jsonb_build_object('name',trim(p_name)));
  return v_token;
end
$$;
