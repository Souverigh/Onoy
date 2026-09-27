-- Магазин — только с разрешения (решение пользователя 27.09.2026). После
-- включения регистрации (продавцы по приглашению) аккаунт может создать
-- любой, поэтому новый магазин требует одноразовый код доступа. Коды выдаёт
-- администратор Depter в SQL Editor:
--   insert into private.shop_signup_codes(note) values ('Малик, Манас') returning code;
-- Таблица в схеме private — через API её не видно и не изменить.
-- Существующие магазины и повтор запроса создания (тот же request_key) код
-- не требуют.
begin;

create table private.shop_signup_codes (
  code text primary key default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  note text,
  created_at timestamptz not null default now(),
  used_by uuid references auth.users(id),
  used_at timestamptz,
  organization_id uuid references public.organizations(id)
);
revoke all on private.shop_signup_codes from public, anon, authenticated;
-- RLS без политик — ещё один замок: читают только security definer функции
-- (для владельца таблицы RLS не действует).
alter table private.shop_signup_codes enable row level security;

drop function public.create_organization(text,uuid);
drop function private.create_organization(text,uuid);

-- Тело — как в foundation.sql, плюс проверка и погашение кода.
create function private.create_organization(org_name text, request_key uuid, signup_code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare org_id uuid; uid uuid := auth.uid(); v_code text;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if request_key is null or length(trim(org_name)) not between 1 and 120 or org_name is null then raise exception 'Invalid organization'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into org_id from public.organizations where created_by=uid and creation_key=request_key;
 if org_id is not null then return org_id; end if;
 select code into v_code from private.shop_signup_codes
 where code=upper(trim(coalesce(signup_code,''))) and used_at is null
 for update;
 if v_code is null then raise exception 'invalid_code'; end if;
 if (select count(*) from public.organizations where created_by=uid)>=3 then raise exception 'Pilot organization limit reached'; end if;
 insert into public.organizations(name,created_by,creation_key) values(trim(org_name),uid,request_key) returning id into org_id;
 insert into public.organization_members(organization_id,user_id) values(org_id,uid);
 update private.shop_signup_codes set used_by=uid, used_at=now(), organization_id=org_id where code=v_code;
 insert into public.audit_events(organization_id,actor_id,action,entity_id) values(org_id,uid,'organization.created',org_id);
 return org_id;
end $$;
revoke all on function private.create_organization(text,uuid,text) from public;
grant execute on function private.create_organization(text,uuid,text) to authenticated;
create function public.create_organization(org_name text, request_key uuid, signup_code text) returns uuid
language sql security invoker set search_path='' as $$
 select private.create_organization(org_name,request_key,signup_code);
$$;
revoke all on function public.create_organization(text,uuid,text) from public;
grant execute on function public.create_organization(text,uuid,text) to authenticated;

commit;
