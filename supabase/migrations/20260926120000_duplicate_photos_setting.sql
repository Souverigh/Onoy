-- Повторное использование одного фото накладной — настройка магазина.
-- block_duplicate_photos=true (по умолчанию): фото, уже ставшее основанием
-- действующей записи, приложить к новой нельзя ('document_in_use').
-- false: для такого фото создаётся ещё один документ, запись проходит, а
-- приложение показывает предупреждение о дубликате.
-- Сторнированные записи и отклонённые заявки фото не занимают — после сторно
-- ошибочной записи правильную можно завести с той же накладной.
begin;

alter table public.organizations
  add column block_duplicate_photos boolean not null default true;
grant update (block_duplicate_photos) on public.organizations to authenticated;

-- Одно фото теперь может стоять за несколькими документами (когда дубликаты
-- разрешены), поэтому уникальность по хешу заменяется обычным индексом.
alter table public.documents drop constraint documents_organization_id_file_hash_key;
create index documents_org_hash_idx on public.documents(organization_id, file_hash);

create function private.document_in_use(p_org uuid, p_document uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
      select 1 from public.purchases
      where organization_id=p_org and document_id=p_document and reversed_at is null)
    or exists(
      select 1 from public.sales
      where organization_id=p_org and document_id=p_document and reversed_at is null)
    or exists(
      select 1 from public.payments
      where organization_id=p_org and document_id=p_document
        and reversed_at is null and status<>'rejected');
$$;
revoke all on function private.document_in_use(uuid,uuid) from public,anon,authenticated;

create or replace function public.create_document(
  p_org uuid, p_kind text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_kind text; v_block boolean;
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

  -- Свободный документ с тем же фото — ни к одной записи не привязан
  -- (повторная попытка после сбоя, смена прихода на продажу) —
  -- переиспользуем, чтобы не плодить копии и взять готовое распознавание.
  select d.id,d.kind into v_id,v_kind from public.documents d
  where d.organization_id=p_org and d.file_hash=p_file_hash
    and not exists(select 1 from public.purchases where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.sales where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.payments where organization_id=p_org and document_id=d.id)
  order by d.created_at
  limit 1
  for update;
  if v_id is not null then
    if v_kind is distinct from p_kind then
      update public.documents set kind=p_kind where organization_id=p_org and id=v_id;
    end if;
    return v_id;
  end if;

  -- Документ сторнированной записи остаётся на ней (unique document_id), так
  -- что для новой записи всегда нужен новый документ; блокируем, только если
  -- фото занято действующей записью и магазин запретил повторы.
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

-- Есть ли у фото этого документа действующая запись — для предупреждения
-- о дубликате, когда повторы разрешены.
create function public.document_is_duplicate(p_org uuid, p_document uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  return exists(
    select 1 from public.documents d
    join public.documents self on self.organization_id=p_org and self.id=p_document
    where d.organization_id=p_org and d.file_hash=self.file_hash and d.id<>p_document
      and private.document_in_use(p_org,d.id)
  );
end
$$;
revoke all on function public.document_is_duplicate(uuid,uuid) from public,anon;
grant execute on function public.document_is_duplicate(uuid,uuid) to authenticated;

commit;
