-- Мягкое удаление фото без записи (просьба пользователя 06.10.2026): «Удалить»
-- только помечает документ (deleted_at) — он пропадает из списков сразу,
-- «Вернуть» снимает пометку. Строки, страницы и распознавание остаются; то же
-- фото, загруженное снова, возвращает этот документ (create_document). Новые
-- колонки и пересоздание политики и функций — данные не меняются.
begin;

alter table public.documents
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id);

-- Помеченные не видны участникам — ни в списках, ни в счётчиках.
drop policy tenant_read on public.documents;
create policy tenant_read on public.documents for select to authenticated
  using (private.is_member(organization_id) and deleted_at is null);

-- Те же проверки, что раньше: нет ни одной записи (даже отменённой);
-- продавец — только загруженное за последние сутки.
create or replace function public.delete_unused_document(p_org uuid, p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_role text; v_created timestamptz; v_kind text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select role into v_role from public.organization_members where organization_id=p_org and user_id=auth.uid();
  if v_role is null then raise exception 'not_a_member'; end if;
  select created_at, kind into v_created, v_kind from public.documents
  where organization_id=p_org and id=p_document and deleted_at is null for update;
  if not found then raise exception 'invalid_document'; end if;
  if v_role <> 'owner' and v_created < now() - interval '1 day' then raise exception 'owner_only'; end if;
  if exists(select 1 from public.sales where organization_id=p_org and document_id=p_document)
    or exists(select 1 from public.purchases where organization_id=p_org and document_id=p_document)
    or exists(select 1 from public.payments where organization_id=p_org and document_id=p_document)
    or exists(select 1 from public.expenses where organization_id=p_org and document_id=p_document)
  then raise exception 'document_in_use'; end if;
  update public.documents set deleted_at=now(), deleted_by=auth.uid()
  where organization_id=p_org and id=p_document;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'document.deleted',p_document,jsonb_build_object('kind',v_kind,'created_at',v_created));
end
$$;

-- «Вернуть»: владелец — любой, продавец — только то, что удалил сам.
create function public.restore_document(p_org uuid, p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select role into v_role from public.organization_members where organization_id=p_org and user_id=auth.uid();
  if v_role is null then raise exception 'not_a_member'; end if;
  update public.documents set deleted_at=null, deleted_by=null
  where organization_id=p_org and id=p_document and deleted_at is not null
    and (v_role='owner' or deleted_by=auth.uid());
  if not found then raise exception 'invalid_document'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'document.restored',p_document,'{}'::jsonb);
end
$$;
revoke all on function public.restore_document(uuid,uuid) from public, anon;
grant execute on function public.restore_document(uuid,uuid) to authenticated;

-- Как в expense_documents.sql; то же фото снова — тот же документ, и пометка
-- «удалено» снимается.
create or replace function public.create_document(
  p_org uuid, p_kind text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_kind text; v_deleted timestamptz; v_block boolean;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('purchase','sale','payment','expense') then raise exception 'invalid_kind'; end if;
  if p_storage_path is null or length(trim(p_storage_path))=0
    or p_file_hash is null or length(trim(p_file_hash))=0
    or p_mime_type is null or length(trim(p_mime_type))=0
  then raise exception 'invalid_document'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  select d.id,d.kind,d.deleted_at into v_id,v_kind,v_deleted from public.documents d
  where d.organization_id=p_org and d.file_hash=p_file_hash
    and not exists(select 1 from public.purchases where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.sales where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.payments where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.expenses where organization_id=p_org and document_id=d.id)
  order by d.created_at
  limit 1
  for update;
  if v_id is not null then
    if v_kind is distinct from p_kind or v_deleted is not null then
      update public.documents set kind=p_kind, deleted_at=null, deleted_by=null
      where organization_id=p_org and id=v_id;
    end if;
    return v_id;
  end if;

  select block_duplicate_photos into v_block from public.organizations where id=p_org;
  if v_block and exists(
    select 1 from public.documents d
    where d.organization_id=p_org and d.file_hash=p_file_hash
      and private.document_in_use(p_org,d.id)
  ) then raise exception 'document_in_use'; end if;

  insert into public.documents(organization_id,storage_path,file_hash,mime_type,kind,status)
  values(p_org,p_storage_path,p_file_hash,p_mime_type,p_kind,'uploaded')
  returning id into v_id;
  return v_id;
end
$$;

commit;
