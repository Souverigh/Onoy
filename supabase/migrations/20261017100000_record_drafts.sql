-- Черновики продажи и прихода товарами (просьба пользователя 17.10.2026):
-- форма ручного ввода сохраняется сама, уход в другой раздел ничего не
-- стирает. Черновик видит только его автор, с любого своего устройства.
-- Долги, склад и отчёты черновики не меняют — это не запись, а заготовка.
-- Новая таблица и функции; существующие данные не трогаются.
begin;

create table public.record_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_by uuid not null references auth.users(id) default auth.uid(),
  kind text not null check (kind in ('sale','purchase')),
  -- Состояние формы: клиент/поставщик, строки, дата, курс. Читает только форма.
  data jsonb not null check (jsonb_typeof(data) = 'object' and length(data::text) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index record_drafts_author_idx on public.record_drafts(organization_id, created_by, kind, updated_at);
alter table public.record_drafts enable row level security;
revoke all on public.record_drafts from anon, authenticated;
grant select on public.record_drafts to authenticated;
create policy author_read on public.record_drafts for select to authenticated
  using (created_by = (select auth.uid()) and private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.record_drafts
  for each row execute function private.reject_blocked_shop();

-- Сохранить черновик: без p_id — новый, с p_id — свой же, того же вида.
-- Удалённый (записан или стёрт) не воскресает: 'draft_gone'.
create function public.save_record_draft(p_org uuid, p_id uuid, p_kind text, p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('sale','purchase') or p_data is null or jsonb_typeof(p_data) <> 'object'
    or length(p_data::text) > 200000
  then raise exception 'invalid_draft'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  if p_id is null then
    -- Не больше 50 черновиков у одного человека в магазине.
    if (select count(*) from public.record_drafts where organization_id=p_org and created_by=auth.uid()) >= 50
    then raise exception 'too_many_drafts'; end if;
    insert into public.record_drafts(organization_id, created_by, kind, data)
    values (p_org, auth.uid(), p_kind, p_data) returning id into v_id;
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'draft.created',v_id,jsonb_build_object('kind',p_kind));
    return v_id;
  end if;
  update public.record_drafts set data=p_data, updated_at=now()
  where organization_id=p_org and id=p_id and created_by=auth.uid() and kind=p_kind
  returning id into v_id;
  if v_id is null then raise exception 'draft_gone'; end if;
  return v_id;
end
$$;

-- Стереть черновик: только свой, только в своём магазине. Уже стёртый — не ошибка
-- (запись по черновику стирает его, повторное нажатие ничего не ломает).
create function public.delete_record_draft(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_kind text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  delete from public.record_drafts
  where organization_id=p_org and id=p_id and created_by=auth.uid()
  returning kind into v_kind;
  if v_kind is not null then
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'draft.deleted',p_id,jsonb_build_object('kind',v_kind));
  end if;
end
$$;

revoke all on function public.save_record_draft(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.save_record_draft(uuid,uuid,text,jsonb) to authenticated;
revoke all on function public.delete_record_draft(uuid,uuid) from public,anon;
grant execute on function public.delete_record_draft(uuid,uuid) to authenticated;

commit;
