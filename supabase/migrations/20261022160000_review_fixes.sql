-- Исправления по проверке кода (22.10.2026):
--  1. Отключённый сотрудник не может и удалять: delete_party, delete_document_line,
--     delete_record_draft проверяли участника напрямую (без disabled_at), а
--     триггер блокировки ловит только insert/update. Теперь — private.is_member.
--  2. get_statement_by_token (доступна по ссылке клиента без входа) больше не
--     отдаёт внутренние комментарии к оплатам, скидкам и возвратам.
--  3. «Открыть заново» чужой отменённой записи продавцом — новая запись за ним,
--     а не за продавцом отменённой (нельзя записать продажу на чужое имя).
--  4. Брошенное «Исправить» по фото: повторное нажатие берёт ту же копию фото,
--     а не создаёт ещё одну.
--  5. Каталог: сохраняются только изменённые галочки (set_catalog_visibility) —
--     товары, которых не было на странице (архив, больше 5000), не трогаются.
-- Только функции; данные не меняются.
begin;

create or replace function public.delete_party(p_org uuid, p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_org)
  then raise exception 'not_a_member'; end if;
  if p_kind not in ('customers','suppliers') then raise exception 'invalid_kind'; end if;
  if private.party_has_records(p_org, p_kind, p_id) then raise exception 'has_records'; end if;
  if p_kind='customers' then
    delete from public.share_links where organization_id=p_org and customer_id=p_id;
    delete from public.customers where organization_id=p_org and id=p_id;
  else
    delete from public.suppliers where organization_id=p_org and id=p_id;
  end if;
  if not found then raise exception 'invalid_party'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'party.deleted',p_id,jsonb_build_object('kind',p_kind));
end
$$;

create or replace function public.delete_document_line(p_org uuid, p_line uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_org)
  then raise exception 'not_a_member'; end if;
  delete from public.document_lines where organization_id=p_org and id=p_line;
  if not found then raise exception 'invalid_line'; end if;
end
$$;

create or replace function public.delete_record_draft(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_kind text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org)
  then raise exception 'not_a_member'; end if;
  delete from public.record_drafts
  where organization_id=p_org and id=p_id and created_by=auth.uid()
  returning kind into v_kind;
  if v_kind is not null then
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'draft.deleted',p_id,jsonb_build_object('kind',v_kind));
  end if;
end
$$;

create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_currency text; v_originals jsonb; v_result jsonb; v_item_sales uuid[];
begin
  select * into v_link from public.share_links l where l.token=p_token and l.revoked_at is null;
  if found then
    v_currency := private.party_currency(v_link.organization_id,'customers',v_link.customer_id);
    select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
      'amount', p.original_amount::text, 'currency', p.original_currency, 'rate', p.fx_rate::text)), '{}'::jsonb)
    into v_originals
    from public.payments p
    where p.organization_id=v_link.organization_id and p.customer_id=v_link.customer_id
      and p.original_currency is not null;
    select coalesce(array_agg(s.id), '{}') into v_item_sales from public.sales s
    where s.organization_id=v_link.organization_id and s.customer_id=v_link.customer_id
      and s.reversed_at is null and not s.is_opening
      and exists(select 1 from public.sale_items i where i.organization_id=s.organization_id and i.sale_id=s.id);
  end if;
  v_result := private.get_statement_by_token_unchecked(p_token)
    || jsonb_build_object('currency', coalesce(v_currency,'KGS'), 'originals', coalesce(v_originals,'{}'::jsonb));
  if cardinality(v_item_sales) > 0 then
    v_result := jsonb_set(v_result, '{entries}', (
      select coalesce(jsonb_agg(
        case when e->>'kind'='sale' and (e->>'id')::uuid = any(v_item_sales) then e || '{"invoice":true}'::jsonb else e end
        order by i), '[]'::jsonb)
      from jsonb_array_elements(v_result->'entries') with ordinality as t(e, i)));
  end if;
  -- Комментарии к оплатам, скидкам и возвратам — внутренние: клиенту по
  -- ссылке их не отдаём (review 22.10.2026).
  if v_result ? 'entries' then
    v_result := jsonb_set(v_result, '{entries}', (
      select coalesce(jsonb_agg(e - 'note' order by i), '[]'::jsonb)
      from jsonb_array_elements(v_result->'entries') with ordinality as t(e, i)));
  end if;
  return v_result;
end
$$;

create or replace function private.finish_correction(p_org uuid, p_kind text, p_from uuid, p_new uuid, p_made_by uuid)
returns void
language plpgsql security definer set search_path='' as $$
declare
  v_owner boolean := private.is_owner(p_org);
  v_old record;
  v_payment uuid;
  v_maker uuid;
  v_default uuid;
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
  -- «Открыть заново» чужой записи продавцом: запись — за ним самим, а не
  -- за тем, чья была отменённая (иначе можно записать продажу на чужое имя).
  v_default := case
    when v_old.reversed_at is not null and not v_owner and v_old.maker_id is distinct from auth.uid()
      then auth.uid() else v_old.maker_id end;
  v_maker := coalesce(p_made_by, v_default);
  if p_made_by is not null and p_made_by is distinct from v_default then
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

create or replace function public.start_correction(p_org uuid, p_kind text, p_id uuid) returns uuid
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
    select d.id into v_new
    from public.audit_events e
    join public.documents d on d.organization_id = p_org and d.id = (e.metadata->>'new_document')::uuid
    where e.organization_id = p_org and e.action = p_kind || '.correction_started' and e.entity_id = p_id
      and e.metadata->>'new_document' is not null and d.kind = p_kind and d.deleted_at is null
      and not exists(select 1 from public.sales x where x.organization_id = p_org and x.document_id = d.id)
      and not exists(select 1 from public.purchases x where x.organization_id = p_org and x.document_id = d.id)
      and not exists(select 1 from public.payments x where x.organization_id = p_org and x.document_id = d.id)
      and not exists(select 1 from public.expenses x where x.organization_id = p_org and x.document_id = d.id)
    order by e.created_at desc limit 1;
    if v_new is not null then return v_new; end if;
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

-- set_catalog_hidden оставлена: её вызывает уже выложенный код, пока не
-- выложен новый (порядок «миграция → код» без сбоя). Новый код — только set_catalog_visibility.

-- Каталог: скрыть p_hide и показать p_show — только эти товары магазина.
create function public.set_catalog_visibility(p_org uuid, p_hide uuid[], p_show uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare v_changed integer;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_hide is null or p_show is null or cardinality(p_hide) + cardinality(p_show) > 10000
     or p_hide && p_show then raise exception 'invalid_catalog'; end if;
  update public.products set catalog_hidden = (id = any(p_hide))
  where organization_id = p_org and (id = any(p_hide) or id = any(p_show))
    and catalog_hidden is distinct from (id = any(p_hide));
  get diagnostics v_changed = row_count;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org, auth.uid(), 'catalog.products',
    jsonb_build_object('changed', v_changed, 'hide', cardinality(p_hide), 'show', cardinality(p_show)));
  return v_changed;
end
$$;
revoke all on function public.set_catalog_visibility(uuid,uuid[],uuid[]) from public, anon;
grant execute on function public.set_catalog_visibility(uuid,uuid[],uuid[]) to authenticated;


create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022160000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
