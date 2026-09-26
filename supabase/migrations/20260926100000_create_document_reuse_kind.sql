-- Одно и то же фото сначала загрузили как приход, запись не сохранилась, потом
-- продавец переключился на продажу с тем же фото — create_document искал
-- существующий документ только того же вида и падал на
-- unique(organization_id,file_hash) (23505), что в приложении выглядело как
-- «приложите фото». Теперь документ с тем же содержимым переиспользуется при
-- любом виде: если он ещё не стал основанием ни одной записи — вид меняется
-- на новый; если уже стал основанием записи другого вида — 'document_in_use'.
begin;

create or replace function public.create_document(
  p_org uuid, p_kind text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_kind text;
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

  select id,kind into v_id,v_kind from public.documents
  where organization_id=p_org and file_hash=p_file_hash
  for update;
  if v_id is null then
    insert into public.documents(organization_id,storage_path,file_hash,mime_type,kind,status)
    values(p_org,p_storage_path,p_file_hash,p_mime_type,p_kind,'uploaded')
    returning id into v_id;
    return v_id;
  end if;
  if v_kind=p_kind then return v_id; end if;

  if exists(select 1 from public.purchases where organization_id=p_org and document_id=v_id)
    or exists(select 1 from public.sales where organization_id=p_org and document_id=v_id)
    or exists(select 1 from public.payments where organization_id=p_org and document_id=v_id)
  then raise exception 'document_in_use'; end if;

  update public.documents set kind=p_kind where organization_id=p_org and id=v_id;
  return v_id;
end
$$;

commit;
