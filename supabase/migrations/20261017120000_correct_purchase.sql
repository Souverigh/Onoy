-- «Исправить приход» (просьба пользователя 17.10.2026) — как correct_sale:
-- одним шагом в базе. Приход по фото: фото копируется новым документом со
-- ВСЕМИ страницами (строки накладной в него запишет новый приход), старый
-- приход отменяется; «Сразу оплатили поставщику» (p_payment) — вместе с ним.
-- Не вышло одно — не меняется ничего.
-- Новая функция; существующие данные не переписываются (отмена — пометка
-- reversed_at, записи остаются в истории).
begin;

create function public.correct_purchase(p_org uuid, p_purchase uuid, p_payment uuid default null) returns uuid
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

  select id, supplier_id, document_id, created_by, created_at, status, is_opening, reversed_at
  into v_purchase
  from public.purchases where organization_id=p_org and id=p_purchase
  for update;
  if not found or v_purchase.status <> 'posted' or v_purchase.is_opening or v_purchase.reversed_at is not null
  then raise exception 'invalid_purchase'; end if;

  -- Владелец — всегда; продавец — свой приход в первые 2 минуты (как undo_recent).
  if not private.is_owner(p_org)
    and not (v_purchase.created_by = auth.uid() and v_purchase.created_at > now() - interval '2 minutes')
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
revoke all on function public.correct_purchase(uuid,uuid,uuid) from public,anon;
grant execute on function public.correct_purchase(uuid,uuid,uuid) to authenticated;

commit;
