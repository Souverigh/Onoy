-- Продавец исправляет свои продажи и приходы (просьба пользователя
-- 22.10.2026): раньше — только в первые 2 минуты, дальше — владелец.
-- «Свои» — чья запись (maker_id, миграция record_maker.sql): кто продал, в
-- том числе если исправление за него записал владелец. Чужие — владелец.
-- Исправление, как и раньше, — отмена (пометка reversed_at, запись остаётся
-- в истории с «Исправление: …») и запись заново. Только функции пересоздаются;
-- данные не меняются. Применять после 20261022110000_record_maker.sql.
begin;

create or replace function public.correct_sale(p_org uuid, p_sale uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_sale record;
  v_doc record;
  v_new uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;

  select id, document_id, created_by, maker_id, created_at, status, is_opening, reversed_at
  into v_sale
  from public.sales where organization_id=p_org and id=p_sale
  for update;
  if not found or v_sale.status <> 'posted' or v_sale.is_opening or v_sale.reversed_at is not null
  then raise exception 'invalid_sale'; end if;

  -- Владелец — всегда; продавец — свою продажу (maker_id) в любое время.
  if not private.is_owner(p_org)
    and v_sale.maker_id is distinct from auth.uid()
  then raise exception 'owner_only'; end if;

  -- Был возврат товара — сначала отменить его, иначе долг посчитается дважды.
  if exists(
    select 1 from public.return_items r
    join public.payments p on p.organization_id = r.organization_id and p.id = r.payment_id
    where r.organization_id=p_org and r.sale_id=p_sale and p.reversed_at is null
  ) then raise exception 'has_returns'; end if;

  if v_sale.document_id is not null then
    select storage_path, file_hash, mime_type into v_doc
    from public.documents where organization_id=p_org and id=v_sale.document_id;
    if not found then raise exception 'invalid_document'; end if;
    -- Новый документ того же фото: строки накладной в него запишет новая продажа.
    insert into public.documents(organization_id, storage_path, file_hash, mime_type, kind, status)
    values (p_org, v_doc.storage_path, v_doc.file_hash, v_doc.mime_type, 'sale', 'uploaded')
    returning id into v_new;
    insert into public.document_pages(organization_id, document_id, page_no, storage_path, file_hash, mime_type)
    select p_org, v_new, page_no, storage_path, file_hash, mime_type
    from public.document_pages
    where organization_id=p_org and document_id=v_sale.document_id;
  end if;

  update public.sales
  set reversed_at=now(), reversed_by=auth.uid(), reversal_comment='Исправление: продажа записывается заново'
  where organization_id=p_org and id=p_sale;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), 'sale.reversed', p_sale,
    jsonb_build_object('comment','Исправление: продажа записывается заново','correction',true,'new_document',v_new));
  return v_new;
end
$$;

create or replace function public.correct_purchase(p_org uuid, p_purchase uuid, p_payment uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_purchase record;
  v_doc record;
  v_new uuid;
  v_comment text := 'Исправление: приход записывается заново';
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;

  select id, supplier_id, document_id, created_by, maker_id, created_at, status, is_opening, reversed_at
  into v_purchase
  from public.purchases where organization_id=p_org and id=p_purchase
  for update;
  if not found or v_purchase.status <> 'posted' or v_purchase.is_opening or v_purchase.reversed_at is not null
  then raise exception 'invalid_purchase'; end if;

  -- Владелец — всегда; продавец — свой приход (maker_id) в любое время.
  if not private.is_owner(p_org)
    and v_purchase.maker_id is distinct from auth.uid()
  then raise exception 'owner_only'; end if;

  -- Оплата поставщику, внесённая вместе с приходом: тот же поставщик и автор,
  -- в первые полминуты (как partPaymentOf в приложении). Чужую — не трогаем.
  if p_payment is not null then
    update public.payments
    set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment || ' (вместе с приходом)'
    where organization_id=p_org and id=p_payment
      and supplier_id=v_purchase.supplier_id and direction='outgoing' and kind='payment'
      and status='confirmed' and reversed_at is null and document_id is null
      and created_by is not distinct from v_purchase.created_by
      and created_at between v_purchase.created_at and v_purchase.created_at + interval '30 seconds';
    if not found then raise exception 'invalid_payment'; end if;
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org, auth.uid(), 'payment.reversed', p_payment,
      jsonb_build_object('comment', v_comment || ' (вместе с приходом)', 'correction', true));
  end if;

  if v_purchase.document_id is not null then
    select storage_path, file_hash, mime_type into v_doc
    from public.documents where organization_id=p_org and id=v_purchase.document_id;
    if not found then raise exception 'invalid_document'; end if;
    insert into public.documents(organization_id, storage_path, file_hash, mime_type, kind, status)
    values (p_org, v_doc.storage_path, v_doc.file_hash, v_doc.mime_type, 'purchase', 'uploaded')
    returning id into v_new;
    insert into public.document_pages(organization_id, document_id, page_no, storage_path, file_hash, mime_type)
    select p_org, v_new, page_no, storage_path, file_hash, mime_type
    from public.document_pages
    where organization_id=p_org and document_id=v_purchase.document_id;
  end if;

  update public.purchases
  set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
  where organization_id=p_org and id=p_purchase;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), 'purchase.reversed', p_purchase,
    jsonb_build_object('comment', v_comment, 'correction', true, 'new_document', v_new, 'payment', p_payment));
  return v_new;
end
$$;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022120000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
