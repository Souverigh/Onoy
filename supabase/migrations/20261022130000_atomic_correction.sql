-- Исправление без «дыры» (просьба пользователя 22.10.2026). Раньше
-- «Исправить» сразу отменяло продажу/приход, а новую запись делали потом:
-- нажал «Исправить» и не записал — запись просто исчезала из долга и кассы.
-- Теперь:
--   start_correction  — только проверяет права и копирует фото; старая запись
--                       остаётся действующей, пока исправляют;
--   commit_*_correction — записывают новую запись и в той же транзакции
--                       отменяют старую (у прихода — и «Сразу оплатили»),
--                       ставят продавца (made_by) и связь (corrected_from).
--                       Не вышло одно — не меняется ничего.
-- «Открыть заново» (старая уже отменена) — те же функции: только связь и
-- продавец. Вторая замена одной и той же записи — ошибка already_corrected.
-- correct_sale / correct_purchase (отмена отдельно от записи) и
-- set_record_maker убираются — обойти замену прямым вызовом нельзя.
-- Только функции; данные не меняются. Применять после 20261022120000.
begin;

drop function public.correct_sale(uuid,uuid);
drop function public.correct_purchase(uuid,uuid,uuid);
drop function public.set_record_maker(uuid,text,uuid,uuid,uuid);

-- «Исправить»: можно ли (владелец — любую, продавец — свою), и копия фото
-- новым документом со всеми страницами. Ничего не отменяет.
create function public.start_correction(p_org uuid, p_kind text, p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_doc uuid;
  v_maker uuid;
  v_status text;
  v_opening boolean;
  v_reversed timestamptz;
  v_file record;
  v_new uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'access_denied'; end if;
  if p_kind = 'sale' then
    select document_id, maker_id, status, is_opening, reversed_at into v_doc, v_maker, v_status, v_opening, v_reversed
    from public.sales where organization_id=p_org and id=p_id;
  elsif p_kind = 'purchase' then
    select document_id, maker_id, status, is_opening, reversed_at into v_doc, v_maker, v_status, v_opening, v_reversed
    from public.purchases where organization_id=p_org and id=p_id;
  else
    raise exception 'invalid_correction';
  end if;
  if not found or v_status <> 'posted' or v_opening or v_reversed is not null then
    raise exception 'invalid_correction';
  end if;
  if not private.is_owner(p_org) and v_maker is distinct from auth.uid() then raise exception 'owner_only'; end if;
  -- Был возврат товара — сначала отменить его, иначе долг посчитается дважды.
  if p_kind = 'sale' and exists(
    select 1 from public.return_items r
    join public.payments p on p.organization_id = r.organization_id and p.id = r.payment_id
    where r.organization_id=p_org and r.sale_id=p_id and p.reversed_at is null
  ) then raise exception 'has_returns'; end if;

  if v_doc is not null then
    select storage_path, file_hash, mime_type into v_file
    from public.documents where organization_id=p_org and id=v_doc;
    if not found then raise exception 'invalid_document'; end if;
    insert into public.documents(organization_id, storage_path, file_hash, mime_type, kind, status)
    values (p_org, v_file.storage_path, v_file.file_hash, v_file.mime_type, p_kind, 'uploaded')
    returning id into v_new;
    insert into public.document_pages(organization_id, document_id, page_no, storage_path, file_hash, mime_type)
    select p_org, v_new, page_no, storage_path, file_hash, mime_type
    from public.document_pages
    where organization_id=p_org and document_id=v_doc;
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), p_kind || '.correction_started', p_id, jsonb_build_object('new_document', v_new));
  return v_new;
end
$$;
revoke all on function public.start_correction(uuid,text,uuid) from public, anon;
grant execute on function public.start_correction(uuid,text,uuid) to authenticated;

-- Новая запись p_new только что записана взамен p_from: отменить старую (если
-- ещё действует), поставить продавца и связь. Вызывается только из
-- commit_*_correction — в той же транзакции, что и запись.
create function private.finish_correction(p_org uuid, p_kind text, p_from uuid, p_new uuid, p_made_by uuid)
returns void
language plpgsql security definer set search_path='' as $$
declare
  v_owner boolean := private.is_owner(p_org);
  v_old record;
  v_payment uuid;
  v_maker uuid;
  v_comment text := case when p_kind = 'sale' then 'Исправление: заменена новой продажей'
                         else 'Исправление: заменён новым приходом' end;
begin
  if p_from is null or p_new is null or p_from = p_new or p_kind not in ('sale','purchase') then
    raise exception 'invalid_correction';
  end if;
  if p_kind = 'sale' then
    select id, maker_id, created_by, created_at, reversed_at, status, is_opening, null::uuid as supplier_id
    into v_old from public.sales where organization_id=p_org and id=p_from for update;
  else
    select id, maker_id, created_by, created_at, reversed_at, status, is_opening, supplier_id
    into v_old from public.purchases where organization_id=p_org and id=p_from for update;
  end if;
  if not found or v_old.status <> 'posted' or v_old.is_opening then raise exception 'invalid_correction'; end if;

  if v_old.reversed_at is null then
    -- Исправление: старая действует — отменяем её здесь же.
    if not v_owner and v_old.maker_id is distinct from auth.uid() then raise exception 'owner_only'; end if;
    if p_kind = 'sale' then
      if exists(
        select 1 from public.return_items r
        join public.payments p on p.organization_id = r.organization_id and p.id = r.payment_id
        where r.organization_id=p_org and r.sale_id=p_from and p.reversed_at is null
      ) then raise exception 'has_returns'; end if;
      update public.sales set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
      where organization_id=p_org and id=p_from;
    else
      -- «Сразу оплатили поставщику» при старом приходе (как partPaymentOf).
      select id into v_payment from public.payments
      where organization_id=p_org and supplier_id=v_old.supplier_id and direction='outgoing' and kind='payment'
        and status='confirmed' and reversed_at is null and document_id is null
        and v_old.created_by is not null and created_by = v_old.created_by
        and created_at between v_old.created_at and v_old.created_at + interval '30 seconds'
      order by created_at limit 1
      for update;
      if v_payment is not null then
        update public.payments
        set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment || ' (вместе с приходом)'
        where organization_id=p_org and id=v_payment;
        insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
        values(p_org, auth.uid(), 'payment.reversed', v_payment,
          jsonb_build_object('comment', v_comment || ' (вместе с приходом)', 'correction', true, 'replaced_by', p_new));
      end if;
      update public.purchases set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
      where organization_id=p_org and id=p_from;
    end if;
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org, auth.uid(), p_kind || '.reversed', p_from,
      jsonb_build_object('comment', v_comment, 'correction', true, 'replaced_by', p_new, 'payment', v_payment));
  else
    -- Старая уже отменена («Открыть заново» или повтор после сбоя связи):
    -- нельзя, чтобы её заменили две живые записи.
    if p_kind = 'sale' and exists(
      select 1 from public.sales where organization_id=p_org and corrected_from=p_from and id<>p_new and reversed_at is null
    ) then raise exception 'already_corrected'; end if;
    if p_kind = 'purchase' and exists(
      select 1 from public.purchases where organization_id=p_org and corrected_from=p_from and id<>p_new and reversed_at is null
    ) then raise exception 'already_corrected'; end if;
  end if;

  -- Продавец — как у старой; другого сотрудника выбирает только владелец.
  v_maker := coalesce(p_made_by, v_old.maker_id);
  if p_made_by is not null and p_made_by is distinct from v_old.maker_id then
    if p_made_by <> auth.uid() and not v_owner then raise exception 'owner_only'; end if;
    if not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_made_by) then
      raise exception 'invalid_correction';
    end if;
  end if;
  if p_kind = 'sale' then
    update public.sales set made_by = v_maker, corrected_from = p_from
    where organization_id = p_org and id = p_new and status = 'posted' and reversed_at is null
      and (corrected_from is null or corrected_from = p_from);
  else
    update public.purchases set made_by = v_maker, corrected_from = p_from
    where organization_id = p_org and id = p_new and status = 'posted' and reversed_at is null
      and (corrected_from is null or corrected_from = p_from);
  end if;
  if not found then raise exception 'invalid_correction'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), p_kind || '.maker_set', p_new, jsonb_build_object('from', p_from, 'made_by', v_maker));
end
$$;
revoke all on function private.finish_correction(uuid,text,uuid,uuid,uuid) from public, anon, authenticated;

-- Запись взамен p_from — те же параметры, что у обычной записи, плюс p_from
-- и p_made_by. Обычная функция проверяет и пишет запись (повтор с тем же
-- ключом вернёт ту же), finish_correction — заменяет старую.
create function public.commit_sale_correction(
  p_from uuid, p_made_by uuid,
  p_org uuid, p_customer uuid, p_amount text, p_paid_immediately boolean, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null, p_line_products jsonb default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_new uuid;
begin
  v_new := public.commit_sale(p_org, p_customer, p_amount, p_paid_immediately, p_idempotency_key, p_document,
    p_original_amount, p_original_currency, p_fx_rate, p_occurred_at, p_line_products);
  perform private.finish_correction(p_org, 'sale', p_from, v_new, p_made_by);
  return v_new;
end
$$;
revoke all on function public.commit_sale_correction(uuid,uuid,uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz,jsonb) from public, anon;
grant execute on function public.commit_sale_correction(uuid,uuid,uuid,uuid,text,boolean,uuid,uuid,text,text,text,timestamptz,jsonb) to authenticated;

create function public.commit_sale_items_correction(
  p_from uuid, p_made_by uuid,
  p_org uuid, p_customer uuid, p_lines jsonb, p_paid_immediately boolean,
  p_idempotency_key uuid, p_fx_rate text default null, p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_new uuid;
begin
  v_new := public.commit_sale_items(p_org, p_customer, p_lines, p_paid_immediately, p_idempotency_key, p_fx_rate, p_occurred_at);
  perform private.finish_correction(p_org, 'sale', p_from, v_new, p_made_by);
  return v_new;
end
$$;
revoke all on function public.commit_sale_items_correction(uuid,uuid,uuid,uuid,jsonb,boolean,uuid,text,timestamptz) from public, anon;
grant execute on function public.commit_sale_items_correction(uuid,uuid,uuid,uuid,jsonb,boolean,uuid,text,timestamptz) to authenticated;

create function public.commit_purchase_correction(
  p_from uuid, p_made_by uuid,
  p_org uuid, p_supplier uuid, p_amount text, p_idempotency_key uuid,
  p_document uuid default null,
  p_original_amount text default null, p_original_currency text default null, p_fx_rate text default null,
  p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_new uuid;
begin
  v_new := public.commit_purchase(p_org, p_supplier, p_amount, p_idempotency_key, p_document,
    p_original_amount, p_original_currency, p_fx_rate, p_occurred_at);
  perform private.finish_correction(p_org, 'purchase', p_from, v_new, p_made_by);
  return v_new;
end
$$;
revoke all on function public.commit_purchase_correction(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,timestamptz) from public, anon;
grant execute on function public.commit_purchase_correction(uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,timestamptz) to authenticated;

create function public.commit_purchase_items_correction(
  p_from uuid, p_made_by uuid,
  p_org uuid, p_supplier uuid, p_lines jsonb, p_idempotency_key uuid, p_fx_rate text default null,
  p_occurred_at timestamptz default null, p_line_currency text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_new uuid;
begin
  v_new := public.commit_purchase_items(p_org, p_supplier, p_lines, p_idempotency_key, p_fx_rate, p_occurred_at, p_line_currency);
  perform private.finish_correction(p_org, 'purchase', p_from, v_new, p_made_by);
  return v_new;
end
$$;
revoke all on function public.commit_purchase_items_correction(uuid,uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text) from public, anon;
grant execute on function public.commit_purchase_items_correction(uuid,uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022130000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
