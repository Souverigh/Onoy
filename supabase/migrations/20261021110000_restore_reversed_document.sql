-- Отменённую запись по фото — обратно (просьба пользователя 21.10.2026): фото
-- отменённой продажи или прихода копируется новым документом со ВСЕМИ
-- страницами, как в correct_sale / correct_purchase; форма по фото откроется
-- со строками отменённой записи, и её запишут заново новой записью.
-- Отменённая запись не меняется и остаётся в истории. Новая функция: только
-- добавляет документ и его страницы.
begin;

create function public.restore_reversed_document(p_org uuid, p_kind text, p_record uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_document uuid;
  v_reversed timestamptz;
  v_doc record;
  v_new uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  if p_kind not in ('sale','purchase') then raise exception 'invalid_kind'; end if;

  if p_kind = 'sale' then
    select document_id, reversed_at into v_document, v_reversed
    from public.sales where organization_id=p_org and id=p_record and status='posted';
  else
    select document_id, reversed_at into v_document, v_reversed
    from public.purchases where organization_id=p_org and id=p_record and status='posted';
  end if;
  if not found or v_reversed is null or v_document is null then raise exception 'invalid_record'; end if;

  select storage_path, file_hash, mime_type into v_doc
  from public.documents where organization_id=p_org and id=v_document;
  if not found then raise exception 'invalid_document'; end if;
  insert into public.documents(organization_id, storage_path, file_hash, mime_type, kind, status)
  values (p_org, v_doc.storage_path, v_doc.file_hash, v_doc.mime_type, p_kind, 'uploaded')
  returning id into v_new;
  insert into public.document_pages(organization_id, document_id, page_no, storage_path, file_hash, mime_type)
  select p_org, v_new, page_no, storage_path, file_hash, mime_type
  from public.document_pages
  where organization_id=p_org and document_id=v_document;

  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), 'document.restored', v_new,
    jsonb_build_object('kind', p_kind, 'record', p_record, 'from_document', v_document));
  return v_new;
end
$$;
revoke all on function public.restore_reversed_document(uuid,text,uuid) from public,anon;
grant execute on function public.restore_reversed_document(uuid,text,uuid) to authenticated;

commit;
