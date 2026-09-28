-- Экран результата (ТЗ §15.2): «Отменить» в течение минуты без причины —
-- ошиблись клиентом или суммой. Может только тот, кто создал запись
-- (продавец тоже — это не сторно задним числом, а отмена только что
-- внесённого), и только в первые 2 минуты (запас на медленную сеть).
-- Дальше — обычная отмена владельцем с причиной. Запись остаётся в истории
-- как отменённая, как и при обычном сторно. Данные не меняются.
begin;

create function public.undo_recent(p_org uuid, p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_comment text := 'Отменено сразу после записи';
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid())
  then raise exception 'not_a_member'; end if;
  if p_kind = 'sale' then
    update public.sales set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
    where organization_id=p_org and id=p_id and created_by=auth.uid()
      and reversed_at is null and created_at > now() - interval '2 minutes';
  elsif p_kind = 'purchase' then
    update public.purchases set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
    where organization_id=p_org and id=p_id and created_by=auth.uid()
      and reversed_at is null and created_at > now() - interval '2 minutes';
  elsif p_kind = 'payment' then
    update public.payments set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
    where organization_id=p_org and id=p_id and created_by=auth.uid() and status='confirmed'
      and reversed_at is null and created_at > now() - interval '2 minutes';
  else
    raise exception 'invalid_kind';
  end if;
  if not found then raise exception 'undo_expired'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),p_kind||'.undone',p_id,'{}'::jsonb);
end
$$;
revoke all on function public.undo_recent(uuid,text,uuid) from public, anon;
grant execute on function public.undo_recent(uuid,text,uuid) to authenticated;

commit;
