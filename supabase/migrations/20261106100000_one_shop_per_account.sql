begin;

-- Один магазин на аккаунт (случай 28.10.2026: клиент открыл три магазина с
-- одного email/Google — форма «Ваш магазин» открывалась снова, и каждый
-- повтор давал новый магазин с новым бесплатным месяцем; приложение при этом
-- открывает только первый). Без кода — второй магазин не создаётся
-- (shop_exists); с кодом от Depter — до трёх, как раньше (сеть точек через
-- админа). Повтор того же запроса (creation_key) по-прежнему возвращает
-- тот же магазин. Данные не меняются: уже открытые магазины остаются.
create or replace function private.create_organization(org_name text, request_key uuid, signup_code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare org_id uuid; uid uuid := auth.uid(); v_code text; v_given text := upper(trim(coalesce(signup_code,'')));
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if request_key is null or length(trim(org_name)) not between 1 and 120 or org_name is null then raise exception 'Invalid organization'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into org_id from public.organizations where created_by=uid and creation_key=request_key;
 if org_id is not null then return org_id; end if;
 if v_given <> '' then
   select code into v_code from private.shop_signup_codes
   where code=v_given and used_at is null
   for update;
   if v_code is null then raise exception 'invalid_code'; end if;
 end if;
 if v_code is null and exists(select 1 from public.organizations where created_by=uid) then raise exception 'shop_exists'; end if;
 if (select count(*) from public.organizations where created_by=uid)>=3 then raise exception 'Pilot organization limit reached'; end if;
 insert into public.organizations(name,created_by,creation_key,paid_until)
 values(trim(org_name),uid,request_key,
   case when v_code is null then ((now() at time zone 'Asia/Bishkek')::date + interval '1 month')::date end)
 returning id into org_id;
 insert into public.organization_members(organization_id,user_id) values(org_id,uid);
 if v_code is not null then
   update private.shop_signup_codes set used_by=uid, used_at=now(), organization_id=org_id where code=v_code;
 end if;
 insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
 values(org_id,uid,'organization.created',org_id,jsonb_build_object('trial',v_code is null));
 return org_id;
end $$;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261106100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
