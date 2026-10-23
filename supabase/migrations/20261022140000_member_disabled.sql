-- Владелец отключает доступ сотруднику (просьба пользователя 22.10.2026) —
-- не удаляя его: имя остаётся в истории, «Продавцах», на накладных, доступ
-- можно вернуть. Отключённый:
--   - не читает данные магазина: private.is_member (на нём RLS всех таблиц)
--     его больше не пропускает; две функции чтения, где участник проверялся
--     напрямую, переведены на is_member;
--   - не может ничего записать даже прямым вызовом функций: тот же триггер,
--     что у заблокированного магазина (reject_blocked_shop), — member_disabled;
--   - свою строку участника видит (приложение покажет «Доступ отключён»).
-- Новая колонка (пустая) и функции; данные не меняются.
begin;

alter table public.organization_members add column disabled_at timestamptz;

create or replace function private.is_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
   select 1 from public.organization_members
   where organization_id=org and user_id=auth.uid() and disabled_at is null);
$$;

-- Один триггер на все таблицы данных магазина — срабатывает и внутри RPC.
create or replace function private.reject_blocked_shop() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Клиент по ссылке (без входа): заявка «Я оплатил» и её фото долг не
  -- меняют — пропускаем, страница клиента должна работать и в этом режиме.
  if auth.uid() is null then return new; end if;
  if private.shop_read_only(new.organization_id) then raise exception 'shop_blocked'; end if;
  if exists(
    select 1 from public.organization_members
    where organization_id=new.organization_id and user_id=auth.uid() and disabled_at is not null
  ) then raise exception 'member_disabled'; end if;
  return new;
end
$$;

-- Отключить / вернуть доступ продавцу: только владелец, не себе.
create function public.set_member_disabled(p_org uuid, p_user uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_user is null or p_user = auth.uid() or p_disabled is null then raise exception 'invalid_member'; end if;
  update public.organization_members
  set disabled_at = case when p_disabled then coalesce(disabled_at, now()) end
  where organization_id=p_org and user_id=p_user and role='staff';
  if not found then raise exception 'invalid_member'; end if;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org, auth.uid(), case when p_disabled then 'member.disabled' else 'member.enabled' end,
    jsonb_build_object('user', p_user));
end
$$;
revoke all on function public.set_member_disabled(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_member_disabled(uuid,uuid,boolean) to authenticated;

create or replace function public.document_is_duplicate(p_org uuid, p_document uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  -- Отключённый сотрудник — не участник (member_disabled.sql).
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  return exists(
    select 1 from public.documents d
    join public.documents self on self.organization_id=p_org and self.id=p_document
    where d.organization_id=p_org and d.file_hash=self.file_hash and d.id<>p_document
      and private.document_in_use(p_org,d.id)
  );
end
$$;

create or replace function public.find_similar_records(
  p_org uuid, p_kind text, p_document uuid, p_party uuid, p_amount text
) returns table(
  r_kind text, r_id uuid, r_occurred_at timestamptz, r_total numeric,
  r_party text, r_document uuid, r_reason text
)
language plpgsql stable security definer set search_path='' as $$
declare v_fp text; v_hash text; v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  -- Отключённый сотрудник — не участник (member_disabled.sql).
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  if p_kind not in ('purchase','sale') then raise exception 'invalid_kind'; end if;
  if p_document is not null then
    select d.content_fingerprint, d.file_hash into v_fp, v_hash
    from public.documents d where d.organization_id=p_org and d.id=p_document;
  end if;
  if coalesce(p_amount,'') ~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then v_amount := p_amount::numeric; end if;

  return query
  select u.kind, u.id, u.occurred_at, u.total, u.party, u.document_id, u.reason
  from (
  select distinct on (m.id) m.kind, m.id, m.occurred_at, m.total, m.party, m.document_id, m.reason
  from (
    -- Та же накладная: документы с тем же отпечатком (индекс по отпечатку),
    -- кроме того же файла фото — о нём предупреждает проверка фото.
    select 'sale'::text as kind, s.id, s.occurred_at, s.total, c.name as party,
      s.document_id, 'content'::text as reason, 0 as priority
    from public.documents d
    join public.sales s on s.organization_id=d.organization_id and s.document_id=d.id
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    where p_kind='sale' and v_fp is not null
      and d.organization_id=p_org and d.content_fingerprint=v_fp
      and d.id<>p_document and d.file_hash<>v_hash and s.reversed_at is null
    union all
    select 'purchase', p.id, p.occurred_at, p.total, sp.name,
      p.document_id, 'content', 0
    from public.documents d
    join public.purchases p on p.organization_id=d.organization_id and p.document_id=d.id
    join public.suppliers sp on sp.organization_id=p.organization_id and sp.id=p.supplier_id
    where p_kind='purchase' and v_fp is not null
      and d.organization_id=p_org and d.content_fingerprint=v_fp
      and d.id<>p_document and d.file_hash<>v_hash and p.reversed_at is null
    union all
    -- Тот же контрагент и та же сумма за 30 дней (индекс контрагент+сумма).
    select 'sale', s.id, s.occurred_at, s.total, c.name,
      s.document_id, 'party_amount', 1
    from public.sales s
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    where p_kind='sale' and p_party is not null and v_amount is not null
      and s.organization_id=p_org and s.customer_id=p_party and s.total=v_amount
      and s.occurred_at > now() - interval '30 days' and s.reversed_at is null
    union all
    select 'purchase', p.id, p.occurred_at, p.total, sp.name,
      p.document_id, 'party_amount', 1
    from public.purchases p
    join public.suppliers sp on sp.organization_id=p.organization_id and sp.id=p.supplier_id
    where p_kind='purchase' and p_party is not null and v_amount is not null
      and p.organization_id=p_org and p.supplier_id=p_party and p.total=v_amount
      and p.occurred_at > now() - interval '30 days' and p.reversed_at is null
  ) m
  order by m.id, m.priority
  ) u
  order by u.occurred_at desc
  limit 3;
end
$$;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022140000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
