-- Многостраничные накладные: страницы 2..N одного документа.
-- Существующие данные не трогаются: первая страница по-прежнему живёт в
-- documents.storage_path/mime_type, а старые документы — просто одностраничные
-- (строк здесь у них нет). documents.file_hash многостраничного документа —
-- хеш набора страниц (считает приложение), поэтому повторное использование,
-- запрет дубликатов и кеш распознавания работают для набора как для одного фото.
-- Страницы, как и всё остальное, принадлежат магазину: organization_id +
-- составной внешний ключ + RLS — чужой магазин их не видит и не может добавить.
begin;

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  document_id uuid not null,
  created_at timestamptz not null default now(),
  page_no integer not null check (page_no between 2 and 10),
  storage_path text not null check (length(trim(storage_path)) > 0),
  file_hash text not null check (length(trim(file_hash)) > 0),
  mime_type text not null check (length(trim(mime_type)) > 0),
  unique (organization_id, id),
  unique (organization_id, document_id, page_no),
  foreign key (organization_id, document_id) references public.documents(organization_id, id)
);
alter table public.document_pages enable row level security;
revoke all on public.document_pages from anon, authenticated;
grant select on public.document_pages to authenticated;
create policy tenant_read on public.document_pages for select to authenticated
  using (private.is_member(organization_id));

-- Страницы 2..N прикрепляются один раз, сразу после create_document. Если
-- create_document вернул уже существующий документ с тем же набором (повтор
-- после сбоя) — страницы у него уже есть, ничего не делаем.
create function public.add_document_pages(p_org uuid, p_document uuid, p_pages jsonb)
returns void
language plpgsql security definer set search_path='' as $$
declare v_page jsonb; v_no integer := 1;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if jsonb_typeof(p_pages) is distinct from 'array'
    or jsonb_array_length(p_pages) not between 1 and 9
  then raise exception 'invalid_pages'; end if;
  perform 1 from public.documents where organization_id=p_org and id=p_document for update;
  if not found then raise exception 'invalid_document'; end if;
  if exists(select 1 from public.document_pages where organization_id=p_org and document_id=p_document)
  then return; end if;

  for v_page in select value from jsonb_array_elements(p_pages) loop
    v_no := v_no + 1;
    -- Файл страницы должен лежать в папке этого же магазина.
    if split_part(coalesce(v_page->>'storage_path',''),'/',1) <> p_org::text
    then raise exception 'invalid_pages'; end if;
    insert into public.document_pages(organization_id,document_id,page_no,storage_path,file_hash,mime_type)
    values(p_org,p_document,v_no,v_page->>'storage_path',v_page->>'file_hash',v_page->>'mime_type');
  end loop;
end
$$;
revoke all on function public.add_document_pages(uuid,uuid,jsonb) from public,anon;
grant execute on function public.add_document_pages(uuid,uuid,jsonb) to authenticated;

commit;
