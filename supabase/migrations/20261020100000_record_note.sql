-- Комментарий к продаже и приходу (просьба пользователя 20.10.2026): продавец
-- пишет пометку при записи («отдал Бакыту», «остаток завтра»), она видна в
-- истории клиента/поставщика. Новые колонки и функция; существующие данные не
-- трогаются.
begin;

alter table public.sales add column note text check (note is null or length(note) <= 500);
alter table public.purchases add column note text check (note is null or length(note) <= 500);

-- Поставить комментарий к записи сразу после неё: автор записи или владелец,
-- только своего магазина. Пустой комментарий — убрать.
create function public.set_record_note(p_org uuid, p_kind text, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'access_denied'; end if;
  if p_kind not in ('sale','purchase') or p_id is null then raise exception 'invalid_note'; end if;
  if length(coalesce(v_note,'')) > 500 then raise exception 'invalid_note'; end if;
  if p_kind = 'sale' then
    update public.sales set note = v_note
    where organization_id = p_org and id = p_id and status = 'posted'
      and (created_by = auth.uid() or private.is_owner(p_org));
  else
    update public.purchases set note = v_note
    where organization_id = p_org and id = p_id and status = 'posted'
      and (created_by = auth.uid() or private.is_owner(p_org));
  end if;
  if not found then raise exception 'invalid_note'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), p_kind || '.note_set', p_id, jsonb_build_object('note', v_note));
end
$$;

revoke all on function public.set_record_note(uuid,text,uuid,text) from public,anon;
grant execute on function public.set_record_note(uuid,text,uuid,text) to authenticated;

commit;
