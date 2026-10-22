-- Комментарий к оплате (просьба пользователя 22.10.2026): в форме «Клиент
-- принёс деньги» / «Я заплатил поставщику» — поле под «Наличные / Перевод».
-- Колонка payments.note уже есть (скидки и возвраты, 20260927150000) и видна
-- в истории клиента/поставщика; здесь только функция учится писать её и для
-- оплаты. Данные не меняются — пересоздаётся функция.
begin;

create or replace function public.set_record_note(p_org uuid, p_kind text, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'access_denied'; end if;
  if p_kind not in ('sale','purchase','payment') or p_id is null then raise exception 'invalid_note'; end if;
  if length(coalesce(v_note,'')) > 500 then raise exception 'invalid_note'; end if;
  if p_kind = 'sale' then
    update public.sales set note = v_note
    where organization_id = p_org and id = p_id and status = 'posted'
      and (created_by = auth.uid() or private.is_owner(p_org));
  elsif p_kind = 'purchase' then
    update public.purchases set note = v_note
    where organization_id = p_org and id = p_id and status = 'posted'
      and (created_by = auth.uid() or private.is_owner(p_org));
  else
    -- Только живые деньги: у скидки и возврата комментарий обязателен и
    -- ставится при записи (commit_adjustment), здесь его не трогаем.
    update public.payments set note = v_note
    where organization_id = p_org and id = p_id and kind = 'payment'
      and reversed_at is null and status <> 'rejected'
      and (created_by = auth.uid() or private.is_owner(p_org));
  end if;
  if not found then raise exception 'invalid_note'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), p_kind || '.note_set', p_id, jsonb_build_object('note', v_note));
end
$$;

revoke all on function public.set_record_note(uuid,text,uuid,text) from public,anon;
grant execute on function public.set_record_note(uuid,text,uuid,text) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
