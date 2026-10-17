-- «Исправить продажу» (просьба пользователя 17.10.2026): одним шагом в базе.
-- Продажа по фото: фото копируется новым документом со ВСЕМИ страницами, и
-- старая продажа отменяется — в одной транзакции. Не вышло скопировать —
-- продажа не отменяется; не вышло отменить — копии нет.
-- Новая функция; существующие данные не переписываются (отмена — как у
-- reverse_sale: пометка reversed_at, запись остаётся в истории).
begin;

create function public.correct_sale(p_org uuid, p_sale uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_sale record;
  v_doc record;
  v_new uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;

  select id, document_id, created_by, created_at, status, is_opening, reversed_at
  into v_sale
  from public.sales where organization_id=p_org and id=p_sale
  for update;
  if not found or v_sale.status <> 'posted' or v_sale.is_opening or v_sale.reversed_at is not null
  then raise exception 'invalid_sale'; end if;

  -- Владелец — всегда; продавец — свою продажу в первые 2 минуты (как undo_recent).
  if not private.is_owner(p_org)
    and not (v_sale.created_by = auth.uid() and v_sale.created_at > now() - interval '2 minutes')
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
revoke all on function public.correct_sale(uuid,uuid) from public,anon;
grant execute on function public.correct_sale(uuid,uuid) to authenticated;

commit;
