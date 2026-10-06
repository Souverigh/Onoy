-- Удалить фото без записи (задачи 14 и 29): документ, к которому не
-- приложена ни одна запись (продажа, товар от поставщика, оплата, расход —
-- даже отменённая). Владелец — любой такой документ, продавец — только
-- загруженный за последние сутки. Удаляются только строки этого документа
-- (распознанные строки, страницы, кеш распознавания) и пишется audit_events.
-- Файл в хранилище остаётся. Записи клиентов и долги не затрагиваются.
begin;

create function public.delete_unused_document(p_org uuid, p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_role text; v_created timestamptz; v_kind text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select role into v_role from public.organization_members where organization_id=p_org and user_id=auth.uid();
  if v_role is null then raise exception 'not_a_member'; end if;
  select created_at, kind into v_created, v_kind from public.documents
  where organization_id=p_org and id=p_document for update;
  if not found then raise exception 'invalid_document'; end if;
  if v_role <> 'owner' and v_created < now() - interval '1 day' then raise exception 'owner_only'; end if;
  if exists(select 1 from public.sales where organization_id=p_org and document_id=p_document)
    or exists(select 1 from public.purchases where organization_id=p_org and document_id=p_document)
    or exists(select 1 from public.payments where organization_id=p_org and document_id=p_document)
    or exists(select 1 from public.expenses where organization_id=p_org and document_id=p_document)
  then raise exception 'document_in_use'; end if;
  delete from public.document_lines where organization_id=p_org and document_id=p_document;
  delete from public.document_pages where organization_id=p_org and document_id=p_document;
  delete from public.document_extractions where organization_id=p_org and document_id=p_document;
  delete from public.documents where organization_id=p_org and id=p_document;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'document.deleted',p_document,jsonb_build_object('kind',v_kind,'created_at',v_created));
end
$$;
revoke all on function public.delete_unused_document(uuid,uuid) from public, anon;
grant execute on function public.delete_unused_document(uuid,uuid) to authenticated;

commit;
