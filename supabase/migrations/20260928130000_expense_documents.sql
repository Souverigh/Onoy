-- Фото расхода — обычный документ (kind='expense'): распознаётся (сумма,
-- дата, продавец, категория) и виден в разделе «Документы». Раньше фото
-- лежали в expenses.photos без documents — такие записи остаются как есть
-- (приложение показывает их фото по-прежнему), новые пишут document_id.
-- Тела create_document и document_in_use — как в duplicate_photos_setting.sql,
-- плюс расходы; cache_extraction — как в adre_extraction_cache.sql, плюс вид
-- извлечения 'expense'. Данные не меняются.
begin;

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('purchase','sale','payment','expense'));

alter table public.expenses add column document_id uuid;
alter table public.expenses add constraint expenses_document_fk
  foreign key (organization_id, document_id) references public.documents(organization_id, id);
alter table public.expenses add constraint expenses_organization_id_document_id_key
  unique (organization_id, document_id);

create or replace function private.document_in_use(p_org uuid, p_document uuid) returns boolean
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
        and reversed_at is null and status<>'rejected')
    or exists(
      select 1 from public.expenses
      where organization_id=p_org and document_id=p_document and reversed_at is null);
$$;

create or replace function public.create_document(
  p_org uuid, p_kind text, p_storage_path text, p_file_hash text, p_mime_type text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_kind text; v_block boolean;
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

  select d.id,d.kind into v_id,v_kind from public.documents d
  where d.organization_id=p_org and d.file_hash=p_file_hash
    and not exists(select 1 from public.purchases where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.sales where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.payments where organization_id=p_org and document_id=d.id)
    and not exists(select 1 from public.expenses where organization_id=p_org and document_id=d.id)
  order by d.created_at
  limit 1
  for update;
  if v_id is not null then
    if v_kind is distinct from p_kind then
      update public.documents set kind=p_kind where organization_id=p_org and id=v_id;
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

create or replace function public.cache_extraction(
  p_org uuid, p_document uuid, p_provider text, p_model text, p_prompt_version text,
  p_raw_json jsonb, p_latency_ms integer, p_cost numeric
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not exists (
    select 1 from public.documents where organization_id=p_org and id=p_document
  ) then raise exception 'invalid_document'; end if;
  if coalesce(p_raw_json->>'kind','') not in ('invoice','receipt','expense')
  then raise exception 'invalid_extraction'; end if;

  insert into public.document_extractions(
    organization_id, document_id, payload, model_version, provider, prompt_version,
    latency_ms, cost
  ) values (
    p_org, p_document, p_raw_json, coalesce(p_model,'unknown'), p_provider, p_prompt_version,
    p_latency_ms, p_cost
  );
end
$$;

-- commit_expense: вместо списка файлов — документ расхода. Старая версия
-- (с p_photos) удаляется: код после этой миграции вызывает новую.
drop function public.commit_expense(uuid,text,text,text,date,jsonb,uuid);
create function public.commit_expense(
  p_org uuid, p_amount text, p_category text, p_note text, p_spent_on date,
  p_document uuid, p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_id uuid; v_amount numeric;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_today date := (now() at time zone 'Asia/Bishkek')::date;
  v_day date := coalesce(p_spent_on, (now() at time zone 'Asia/Bishkek')::date);
  v_currency text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or p_category not in ('rent','salary','transport','utilities','taxes','supplies','food','other')
  then raise exception 'invalid_expense'; end if;
  v_amount := p_amount::numeric;
  if v_amount <= 0 or v_amount >= 100000000000000 then raise exception 'invalid_expense'; end if;
  if length(coalesce(v_note,'')) > 500 or (p_category = 'other' and v_note is null)
  then raise exception 'invalid_note'; end if;
  if v_day > v_today or v_day < v_today - 366 then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if p_document is not null and not exists(
    select 1 from public.documents where organization_id=p_org and id=p_document and kind='expense'
  ) then raise exception 'invalid_document'; end if;

  v_hash := md5(jsonb_build_object(
    'amount',v_amount::text,'category',p_category,'note',v_note,'day',v_day,'document',p_document
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.expenses where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  select currency into v_currency from public.organizations where id=p_org;
  insert into public.expenses(
    organization_id,spent_on,amount,currency,category,note,document_id,idempotency_key,request_hash
  ) values(
    p_org,v_day,v_amount,coalesce(v_currency,'KGS'),p_category,v_note,p_document,p_idempotency_key,v_hash
  ) returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'expense.created',v_id,
    jsonb_build_object('amount',v_amount::text,'category',p_category,'day',v_day));
  return v_id;
end
$$;
revoke all on function public.commit_expense(uuid,text,text,text,date,uuid,uuid) from public,anon;
grant execute on function public.commit_expense(uuid,text,text,text,date,uuid,uuid) to authenticated;

commit;
