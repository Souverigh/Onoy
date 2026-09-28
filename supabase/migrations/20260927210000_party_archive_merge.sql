-- Удаление, архив и объединение клиентов и поставщиков (ТЗ §15.2, аудит
-- 15.1 п. 5). Удалить — только без единой операции (включая отменённые и
-- заявки). Иначе «В архив»: пропадает из списков и форм, история и ссылка
-- сохраняются, «Вернуть». Дубли — «Объединить с…»: операции и ссылки
-- переносятся на остающегося, имя второго — его синоним; отмена в течение
-- суток. Объединение переносит денежные записи — только владелец; архив и
-- удаление — все участники (справочники доступны продавцу, решение
-- пользователя). Новые колонки null — существующие данные не меняются.
begin;

alter table public.customers
  add column archived_at timestamptz,
  add column merged_into_id uuid;
alter table public.suppliers
  add column archived_at timestamptz,
  add column merged_into_id uuid;

-- Балансы раскрывают c.* при создании — пересоздаём (тела как раньше).
drop view public.customer_balances;
create view public.customer_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.sales s
       where s.organization_id=c.organization_id and s.customer_id=c.id
         and s.status='posted' and not s.paid_immediately and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.customer_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.customers c;
drop view public.supplier_balances;
create view public.supplier_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.purchases s
       where s.organization_id=c.organization_id and s.supplier_id=c.id
         and s.status='posted' and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.supplier_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.suppliers c;
revoke all on public.customer_balances, public.supplier_balances from anon, authenticated;
grant select on public.customer_balances, public.supplier_balances to authenticated;

-- Журнал объединений: что перенесли — чтобы отменить в течение суток.
create table public.party_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('customers','suppliers')),
  from_id uuid not null,
  into_id uuid not null,
  moved jsonb not null,
  added_aliases text[] not null default '{}',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table public.party_merges enable row level security;
revoke all on public.party_merges from anon, authenticated;
grant select on public.party_merges to authenticated;
create policy tenant_read on public.party_merges for select to authenticated using (private.is_member(organization_id));

create function private.party_has_records(p_org uuid, p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_kind='customers' then
    exists(select 1 from public.sales where organization_id=p_org and customer_id=p_id)
    or exists(select 1 from public.payments where organization_id=p_org and customer_id=p_id)
  else
    exists(select 1 from public.purchases where organization_id=p_org and supplier_id=p_id)
    or exists(select 1 from public.payments where organization_id=p_org and supplier_id=p_id)
  end;
$$;

create function public.delete_party(p_org uuid, p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  if p_kind not in ('customers','suppliers') then raise exception 'invalid_kind'; end if;
  if private.party_has_records(p_org, p_kind, p_id) then raise exception 'has_records'; end if;
  if p_kind='customers' then
    delete from public.share_links where organization_id=p_org and customer_id=p_id;
    delete from public.customers where organization_id=p_org and id=p_id;
  else
    delete from public.suppliers where organization_id=p_org and id=p_id;
  end if;
  if not found then raise exception 'invalid_party'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'party.deleted',p_id,jsonb_build_object('kind',p_kind));
end
$$;

create function public.set_party_archived(p_org uuid, p_kind text, p_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  if p_kind='customers' then
    update public.customers set archived_at=case when p_archived then now() end
    where organization_id=p_org and id=p_id and merged_into_id is null;
  elsif p_kind='suppliers' then
    update public.suppliers set archived_at=case when p_archived then now() end
    where organization_id=p_org and id=p_id and merged_into_id is null;
  else raise exception 'invalid_kind'; end if;
  if not found then raise exception 'invalid_party'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),case when p_archived then 'party.archived' else 'party.restored' end,p_id,jsonb_build_object('kind',p_kind));
end
$$;

create function public.merge_party(p_org uuid, p_kind text, p_from uuid, p_into uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_from record; v_into record; v_moved jsonb; v_aliases text[]; v_id uuid;
  v_sales uuid[]; v_purchases uuid[]; v_payments uuid[]; v_links uuid[];
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_kind not in ('customers','suppliers') or p_from = p_into then raise exception 'invalid_party'; end if;
  if p_kind='customers' then
    select id, name, aliases into v_from from public.customers where organization_id=p_org and id=p_from and merged_into_id is null for update;
    if not found then raise exception 'invalid_party'; end if;
    select id, name, aliases into v_into from public.customers where organization_id=p_org and id=p_into and merged_into_id is null for update;
    if not found then raise exception 'invalid_party'; end if;
  else
    select id, name, aliases into v_from from public.suppliers where organization_id=p_org and id=p_from and merged_into_id is null for update;
    if not found then raise exception 'invalid_party'; end if;
    select id, name, aliases into v_into from public.suppliers where organization_id=p_org and id=p_into and merged_into_id is null for update;
    if not found then raise exception 'invalid_party'; end if;
  end if;

  -- «Один перенос из тетради на контрагента»: два действующих — сначала отменить один.
  if p_kind='customers' and (
    (exists(select 1 from public.sales where organization_id=p_org and customer_id=p_from and is_opening and reversed_at is null)
     and exists(select 1 from public.sales where organization_id=p_org and customer_id=p_into and is_opening and reversed_at is null))
    or (exists(select 1 from public.payments where organization_id=p_org and customer_id=p_from and is_opening and reversed_at is null)
     and exists(select 1 from public.payments where organization_id=p_org and customer_id=p_into and is_opening and reversed_at is null))
  ) or p_kind='suppliers' and (
    (exists(select 1 from public.purchases where organization_id=p_org and supplier_id=p_from and is_opening and reversed_at is null)
     and exists(select 1 from public.purchases where organization_id=p_org and supplier_id=p_into and is_opening and reversed_at is null))
    or (exists(select 1 from public.payments where organization_id=p_org and supplier_id=p_from and is_opening and reversed_at is null)
     and exists(select 1 from public.payments where organization_id=p_org and supplier_id=p_into and is_opening and reversed_at is null))
  ) then raise exception 'opening_conflict'; end if;

  if p_kind='customers' then
    with m as (update public.sales set customer_id=p_into where organization_id=p_org and customer_id=p_from returning id)
      select coalesce(array_agg(id),'{}') into v_sales from m;
    with m as (update public.payments set customer_id=p_into where organization_id=p_org and customer_id=p_from returning id)
      select coalesce(array_agg(id),'{}') into v_payments from m;
    with m as (update public.share_links set customer_id=p_into where organization_id=p_org and customer_id=p_from returning id)
      select coalesce(array_agg(id),'{}') into v_links from m;
    v_moved := jsonb_build_object('sales',to_jsonb(v_sales),'payments',to_jsonb(v_payments),'share_links',to_jsonb(v_links));
  else
    with m as (update public.purchases set supplier_id=p_into where organization_id=p_org and supplier_id=p_from returning id)
      select coalesce(array_agg(id),'{}') into v_purchases from m;
    with m as (update public.payments set supplier_id=p_into where organization_id=p_org and supplier_id=p_from returning id)
      select coalesce(array_agg(id),'{}') into v_payments from m;
    v_moved := jsonb_build_object('purchases',to_jsonb(v_purchases),'payments',to_jsonb(v_payments));
  end if;

  -- Имя и синонимы второго — синонимы остающегося (запоминаем, что добавили).
  select coalesce(array_agg(a),'{}') into v_aliases
  from (select distinct unnest(array_append(v_from.aliases, v_from.name)) as a) t
  where not (a = any(v_into.aliases)) and lower(a) <> lower(v_into.name);
  if p_kind='customers' then
    update public.customers set aliases=aliases || v_aliases where organization_id=p_org and id=p_into;
    update public.customers set merged_into_id=p_into, archived_at=now() where organization_id=p_org and id=p_from;
  else
    update public.suppliers set aliases=aliases || v_aliases where organization_id=p_org and id=p_into;
    update public.suppliers set merged_into_id=p_into, archived_at=now() where organization_id=p_org and id=p_from;
  end if;

  insert into public.party_merges(organization_id,kind,from_id,into_id,moved,added_aliases)
  values(p_org,p_kind,p_from,p_into,v_moved,v_aliases) returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'party.merged',p_into,jsonb_build_object('kind',p_kind,'from',p_from,'merge',v_id));
  return v_id;
end
$$;

-- Отмена объединения в течение суток: переносим обратно ровно то, что переносили.
create function public.undo_merge(p_org uuid, p_merge uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v record;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select * into v from public.party_merges
  where organization_id=p_org and id=p_merge and undone_at is null and created_at > now() - interval '1 day'
  for update;
  if not found then raise exception 'undo_expired'; end if;
  if v.kind='customers' then
    update public.sales set customer_id=v.from_id
    where organization_id=p_org and id in (select jsonb_array_elements_text(v.moved->'sales')::uuid);
    update public.payments set customer_id=v.from_id
    where organization_id=p_org and id in (select jsonb_array_elements_text(v.moved->'payments')::uuid);
    update public.share_links set customer_id=v.from_id
    where organization_id=p_org and id in (select jsonb_array_elements_text(v.moved->'share_links')::uuid);
    update public.customers set aliases=array(select a from unnest(aliases) a where not (a = any(v.added_aliases)))
    where organization_id=p_org and id=v.into_id;
    update public.customers set merged_into_id=null, archived_at=null where organization_id=p_org and id=v.from_id;
  else
    update public.purchases set supplier_id=v.from_id
    where organization_id=p_org and id in (select jsonb_array_elements_text(v.moved->'purchases')::uuid);
    update public.payments set supplier_id=v.from_id
    where organization_id=p_org and id in (select jsonb_array_elements_text(v.moved->'payments')::uuid);
    update public.suppliers set aliases=array(select a from unnest(aliases) a where not (a = any(v.added_aliases)))
    where organization_id=p_org and id=v.into_id;
    update public.suppliers set merged_into_id=null, archived_at=null where organization_id=p_org and id=v.from_id;
  end if;
  update public.party_merges set undone_at=now() where id=v.id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'party.merge_undone',v.into_id,jsonb_build_object('merge',v.id));
end
$$;

revoke all on function public.delete_party(uuid,text,uuid) from public, anon;
revoke all on function public.set_party_archived(uuid,text,uuid,boolean) from public, anon;
revoke all on function public.merge_party(uuid,text,uuid,uuid) from public, anon;
revoke all on function public.undo_merge(uuid,uuid) from public, anon;
grant execute on function public.delete_party(uuid,text,uuid) to authenticated;
grant execute on function public.set_party_archived(uuid,text,uuid,boolean) to authenticated;
grant execute on function public.merge_party(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.undo_merge(uuid,uuid) to authenticated;

commit;
