-- Повторная загрузка того же фото (например, после сбоя на более позднем шаге
-- проведения операции) не должна падать на unique(organization_id,file_hash) —
-- create_document теперь переиспользует уже существующий документ с тем же
-- содержимым и видом вместо ошибки 23505.
begin;

create or replace function public.create_document(
  p_org uuid, p_kind text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_kind not in ('purchase','sale','payment') then raise exception 'invalid_kind'; end if;
  if p_storage_path is null or length(trim(p_storage_path))=0
    or p_file_hash is null or length(trim(p_file_hash))=0
    or p_mime_type is null or length(trim(p_mime_type))=0
  then raise exception 'invalid_document'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;

  select id into v_id from public.documents
  where organization_id=p_org and file_hash=p_file_hash and kind=p_kind;
  if v_id is not null then return v_id; end if;

  insert into public.documents(organization_id,storage_path,file_hash,mime_type,kind,status)
  values(p_org,p_storage_path,p_file_hash,p_mime_type,p_kind,'uploaded')
  returning id into v_id;
  return v_id;
end
$$;

commit;
