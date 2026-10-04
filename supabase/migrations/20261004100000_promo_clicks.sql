-- Реклама Depter на накладных (просьба пользователя 04.10.2026): QR внизу
-- накладной ведёт на /r/<код магазина>, переход записывается и редиректит на
-- сайт. Счётчики по магазинам видит только администратор платформы. Код —
-- случайный, по нему не узнать магазин; данные магазинов не меняются.
begin;

create table private.promo_refs (
  organization_id uuid primary key references public.organizations(id),
  ref text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,10),
  created_at timestamptz not null default now()
);
-- Переход по QR: только магазин и время — без IP и данных устройства.
create table private.promo_clicks (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now()
);
create index promo_clicks_org_idx on private.promo_clicks(organization_id, created_at);
revoke all on private.promo_refs from public, anon, authenticated;
revoke all on private.promo_clicks from public, anon, authenticated;
alter table private.promo_refs enable row level security;
alter table private.promo_clicks enable row level security;

-- Код магазина для QR; создаётся при первой накладной.
create function private.promo_ref_for(p_org uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
  insert into private.promo_refs(organization_id) values(p_org) on conflict (organization_id) do nothing;
  return (select ref from private.promo_refs where organization_id=p_org);
end
$$;
revoke all on function private.promo_ref_for(uuid) from public;

-- Накладная из приложения: только участник магазина.
create function public.promo_ref(p_org uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  return private.promo_ref_for(p_org);
end
$$;

-- Накладная по ссылке клиента (без входа): магазин — по действующей ссылке.
create function public.promo_ref_by_token(p_token text) returns text
language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.share_links where token=p_token and revoked_at is null;
  if v_org is null then return null; end if;
  return private.promo_ref_for(v_org);
end
$$;

-- Переход по QR. Неизвестный код молча пропускается.
create function public.track_promo_click(p_ref text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_ref is null or length(p_ref) > 20 then return; end if;
  insert into private.promo_clicks(organization_id)
  select organization_id from private.promo_refs where ref=p_ref;
end
$$;

-- Админка: переходы по магазинам.
create function public.admin_promo_clicks() returns table(
  organization_id uuid, clicks_7d int, clicks_30d int, clicks_total int, last_click timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select c.organization_id,
    (count(*) filter (where c.created_at > now()-interval '7 days'))::int,
    (count(*) filter (where c.created_at > now()-interval '30 days'))::int,
    count(*)::int,
    max(c.created_at)
  from private.promo_clicks c
  group by c.organization_id;
end
$$;

revoke all on function public.promo_ref(uuid) from public, anon;
revoke all on function public.promo_ref_by_token(text) from public;
revoke all on function public.track_promo_click(text) from public;
revoke all on function public.admin_promo_clicks() from public, anon;
grant execute on function public.promo_ref(uuid) to authenticated;
grant execute on function public.promo_ref_by_token(text) to anon, authenticated;
grant execute on function public.track_promo_click(text) to anon, authenticated;
grant execute on function public.admin_promo_clicks() to authenticated;

commit;
