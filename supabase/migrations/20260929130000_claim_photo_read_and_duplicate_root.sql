-- 1) Фото квитанции клиента («Я оплатил», путь receipts/claims/<token>/…)
--    не открывалось у владельца: политика «org members read receipts»
--    делает ((storage.foldername(name))[1])::uuid, и на 'claims' каст падает
--    с ошибкой — политики не «срабатывают по очереди», ошибка одной ломает
--    чтение, даже когда вторая («org members read claim receipts»)
--    разрешила бы. Проверка папки магазина — через функцию без ошибки.
-- 2) Дубликат всегда указывает на исходную оплату, а не на другой дубликат
--    (клиент дважды прислал тот же файл → цепочка). Номер перевода с чека
--    важнее совпадения по фото.
-- 3) Распознанная квитанция клиента — документ «Оцифрована», а не «Ожидает».
-- Существующие строки не переписываются.
begin;

create function private.storage_folder_member(p_folder text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if p_folder is null
    or p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then return false; end if;
  return private.is_member(p_folder::uuid);
end
$$;
revoke all on function private.storage_folder_member(text) from public;
grant execute on function private.storage_folder_member(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "org members upload receipts" on storage.objects;
    create policy "org members upload receipts" on storage.objects
      for insert to authenticated with check (
        bucket_id = 'receipts'
        and private.storage_folder_member((storage.foldername(name))[1])
      );
    drop policy if exists "org members read receipts" on storage.objects;
    create policy "org members read receipts" on storage.objects
      for select to authenticated using (
        bucket_id = 'receipts'
        and private.storage_folder_member((storage.foldername(name))[1])
      );
  end if;
end
$$;

create or replace function public.submit_payment_claim(
  p_token text, p_amount text, p_comment text, p_receipt_document uuid default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_link record; v_amount numeric; v_id uuid; v_duplicate_of uuid;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select * into v_link from public.share_links where token=p_token and revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  if coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_amount'; end if;
  v_amount := p_amount::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_amount'; end if;
  if p_receipt_document is not null and not exists(
    select 1 from public.documents
    where organization_id=v_link.organization_id and id=p_receipt_document and kind='payment'
  ) then raise exception 'invalid_document'; end if;

  -- То же фото квитанции уже приложено к действующей оплате магазина;
  -- если та сама дубликат — ссылаемся на исходную.
  if p_receipt_document is not null then
    select coalesce(p.duplicate_of, p.id) into v_duplicate_of
    from public.documents mine
    join public.documents d on d.organization_id=mine.organization_id and d.file_hash=mine.file_hash
      and d.id<>mine.id
    join public.payments p on p.organization_id=d.organization_id and p.document_id=d.id
    where mine.organization_id=v_link.organization_id and mine.id=p_receipt_document
      and p.status in ('confirmed','pending') and p.reversed_at is null
    order by (p.status='confirmed') desc, (p.duplicate_of is null) desc, p.created_at
    limit 1;
  end if;

  insert into public.payments(
    organization_id,customer_id,direction,amount,status,claim_comment,document_id,idempotency_key,duplicate_of
  ) values(
    v_link.organization_id, v_link.customer_id, 'incoming', v_amount, 'pending',
    nullif(trim(coalesce(p_comment,'')),''), p_receipt_document, gen_random_uuid(), v_duplicate_of
  ) returning id into v_id;
  insert into public.audit_events(organization_id,action,entity_id,metadata)
  values(v_link.organization_id,'payment.claim_submitted',v_link.customer_id,
    jsonb_build_object('amount',v_amount::text,'comment',left(coalesce(p_comment,''),2000))
    || case when v_duplicate_of is null then '{}'::jsonb
            else jsonb_build_object('duplicate_of',v_duplicate_of) end);
  return v_id;
end
$$;

create or replace function public.note_claim_receipt(
  p_token text, p_payment uuid, p_bank_reference text,
  p_provider text, p_model text, p_prompt_version text,
  p_raw_json jsonb, p_latency_ms integer, p_cost numeric
) returns void
language plpgsql security definer set search_path='' as $$
declare v_link record; v_pay record; v_ref text := nullif(trim(coalesce(p_bank_reference,'')),''); v_dup uuid;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select * into v_link from public.share_links where token=p_token and revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  select * into v_pay from public.payments
  where organization_id=v_link.organization_id and id=p_payment and customer_id=v_link.customer_id
    and status='pending' and created_by is null and document_id is not null
    and created_at > now() - interval '1 hour'
  for update;
  if not found then raise exception 'invalid_payment'; end if;
  if v_ref is not null and length(v_ref) > 200 then v_ref := null; end if;

  if p_raw_json is not null and p_raw_json->>'kind'='receipt' and length(p_raw_json::text) < 200000
    and not exists(select 1 from public.document_extractions
                   where organization_id=v_link.organization_id and document_id=v_pay.document_id)
  then
    insert into public.document_extractions(
      organization_id, document_id, payload, model_version, provider, prompt_version, latency_ms, cost
    ) values (
      v_link.organization_id, v_pay.document_id, p_raw_json, coalesce(p_model,'unknown'),
      p_provider, p_prompt_version, p_latency_ms, p_cost
    );
    update public.documents set status='digitized'
    where organization_id=v_link.organization_id and id=v_pay.document_id
      and status in ('uploaded','processing');
  end if;

  if v_ref is null or v_pay.bank_reference is not null then return; end if;
  -- Исходная оплата с этим номером (не дубликат) — важнее совпадения по фото.
  select coalesce(duplicate_of, id) into v_dup from public.payments
  where organization_id=v_link.organization_id and bank_reference=v_ref and id<>p_payment
    and status in ('confirmed','pending') and reversed_at is null
  order by (status='confirmed') desc, (duplicate_of is null) desc, created_at
  limit 1;
  if v_dup = p_payment then v_dup := null; end if;
  update public.payments set bank_reference=v_ref, duplicate_of=coalesce(v_dup, duplicate_of)
  where organization_id=v_link.organization_id and id=p_payment;
end
$$;

commit;
