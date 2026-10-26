-- Push-уведомления на телефон (задача № 8 «Задачи Ержану», решение
-- пользователя 26.10.2026): новый заказ из каталога — всем в магазине,
-- клиент нажал «Я оплатил» — владельцу. Отправляет сервер Depter
-- (src/lib/push.ts) после того, как клиент без входа отправил заказ или
-- заявку; ключа service_role у приложения нет, поэтому список телефонов
-- отдаёт функция push_targets только по секрету сервера (PUSH_SECRET в
-- Vercel). В базе — не сам секрет, а его sha256.
--
-- Новая таблица подписок (какой телефон какого сотрудника подписан) и
-- функции. Существующие данные не меняются.
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- Адрес телефона у Google/Apple/Mozilla и ключи шифрования (PushSubscription).
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  user_agent text check (user_agent is null or length(user_agent) <= 300)
);
create index push_subscriptions_org_idx on public.push_subscriptions(organization_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
-- Каждый видит только свои телефоны (Настройки → «Уведомления»).
create policy own_read on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

create table private.push_settings (
  id integer primary key check (id = 1),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$')
);
-- Схема private наружу не отдаётся и прав нет; RLS — вторым замком.
-- Читает только push_secret_ok (security definer, владелец таблицы).
alter table private.push_settings enable row level security;
revoke all on private.push_settings from public, anon, authenticated;
insert into private.push_settings(id, secret_hash)
values (1, 'c7aab8e3aaeb2244a8e25f2ea31651918c1f44b6011d8b4e2592ae9cdac712da');

create function private.push_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(p_secret, '') <> '' and exists(
    select 1 from private.push_settings
    where id = 1 and secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
$$;
revoke all on function private.push_secret_ok(text) from public, anon, authenticated;

-- Этот телефон получает уведомления магазина (кнопка в Настройках). Тот же
-- телефон после входа под другим сотрудником — подписка переходит к нему.
create function public.save_push_subscription(
  p_org uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_member(p_org);
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
    or length(coalesce(p_p256dh, '')) not between 1 and 200
    or length(coalesce(p_auth, '')) not between 1 and 100
  then raise exception 'invalid_subscription'; end if;
  insert into public.push_subscriptions(organization_id, user_id, endpoint, p256dh, auth, user_agent)
  values (p_org, auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set organization_id = excluded.organization_id, user_id = excluded.user_id,
        p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'push.subscribed', auth.uid(), jsonb_build_object('user_agent', left(p_user_agent, 120)));
end
$$;
revoke all on function public.save_push_subscription(uuid,text,text,text,text) from public, anon;
grant execute on function public.save_push_subscription(uuid,text,text,text,text) to authenticated;

-- «Выключить на этом телефоне» — только свою подписку.
create function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
  returning organization_id into v_org;
  if v_org is not null then
    insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
    values (v_org, auth.uid(), 'push.unsubscribed', auth.uid(), '{}'::jsonb);
  end if;
end
$$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Кому и что отправить (только серверу Depter, по секрету): 'order' — новый
-- заказ из каталога, всем действующим сотрудникам магазина; 'claim' —
-- заявка «Я оплатил», владельцам. Только ещё не обработанные.
create function public.push_targets(p_secret text, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; v_info jsonb; v_owner_only boolean;
begin
  if not private.push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  if p_kind = 'order' then
    select o.organization_id, jsonb_build_object(
        'name', coalesce(c.name, o.buyer_name, o.buyer_phone, ''),
        'total', o.total::text, 'lines', jsonb_array_length(o.items),
        'currency', coalesce(org.currency, 'KGS'))
      into v_org, v_info
    from public.catalog_orders o
    join public.organizations org on org.id = o.organization_id
    left join public.customers c on c.organization_id = o.organization_id and c.id = o.customer_id
    where o.id = p_id and o.status = 'new';
    v_owner_only := false;
  elsif p_kind = 'claim' then
    select p.organization_id, jsonb_build_object(
        'name', c.name, 'amount', p.amount::text,
        'currency', coalesce(c.currency, org.currency, 'KGS'))
      into v_org, v_info
    from public.payments p
    join public.organizations org on org.id = p.organization_id
    join public.customers c on c.organization_id = p.organization_id and c.id = p.customer_id
    where p.id = p_id and p.status = 'pending';
    v_owner_only := true;
  else
    raise exception 'invalid_kind';
  end if;
  if v_org is null then return null; end if;
  return v_info || jsonb_build_object('kind', p_kind, 'targets', coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
    from public.push_subscriptions s
    join public.organization_members m on m.organization_id = s.organization_id and m.user_id = s.user_id
    where s.organization_id = v_org and m.disabled_at is null and (not v_owner_only or m.role = 'owner')
  ), '[]'::jsonb));
end
$$;
revoke all on function public.push_targets(text,text,uuid) from public;
grant execute on function public.push_targets(text,text,uuid) to anon, authenticated;

-- Телефон отписался или сменился (сервис ответил 404/410) — подписку убираем.
create function public.drop_push_subscription(p_secret text, p_endpoint text) returns void
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_user uuid;
begin
  if not private.push_secret_ok(p_secret) then raise exception 'forbidden'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint
  returning organization_id, user_id into v_org, v_user;
  if v_org is not null then
    insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
    values (v_org, null, 'push.expired', v_user, '{}'::jsonb);
  end if;
end
$$;
revoke all on function public.drop_push_subscription(text,text) from public;
grant execute on function public.drop_push_subscription(text,text) to anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261031100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
