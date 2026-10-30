-- «Заявки» в новой админке (просьба пользователя 30.10.2026): статус заявки
-- (новая / написали / готово), заметки с «связаться снова», совпадение с
-- аккаунтом Depter по email или телефону. Только добавляет: у уже пришедших
-- заявок статус — «новая» (значение по умолчанию новой колонки), тексты
-- заявок не меняются.
begin;

alter table private.feedback_messages
  add column status text not null default 'new' check (status in ('new', 'contacted', 'done')),
  add column status_at timestamptz;

-- Заметки бывают и к заявке: ровно к чему-то одному не обязательно, но хоть к чему-то.
alter table private.admin_notes add column feedback_id bigint references private.feedback_messages(id);
alter table private.admin_notes drop constraint if exists admin_notes_check;
alter table private.admin_notes add constraint admin_notes_target
  check (num_nonnulls(organization_id, user_id, feedback_id) >= 1);
create index admin_notes_feedback on private.admin_notes(feedback_id, created_at desc);

-- Новый набор колонок — функцию пересоздаём (данных в ней нет).
drop function public.admin_feedback();
create function public.admin_feedback() returns table(
  id bigint, name text, contact text, message text, created_at timestamptz,
  status text, status_at timestamptz, next_contact date, last_note text,
  match_org uuid, match_user uuid, match_name text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select f.id, f.name, f.contact, f.message, f.created_at, f.status, f.status_at,
    nt.next_contact, nt.body,
    m.org_id, m.user_id, m.label
  from private.feedback_messages f
  left join lateral (
    select n.next_contact, n.body from private.admin_notes n
    where n.feedback_id = f.id order by n.created_at desc limit 1
  ) nt on true
  -- Тот же человек уже в Depter: email аккаунта или телефон магазина (последние 9 цифр).
  left join lateral (
    select o.id as org_id, u.id as user_id, coalesce(o.name, u.email::text) as label
    from auth.users u
    left join public.organizations o on o.created_by = u.id
    where (position('@' in f.contact) > 0 and lower(u.email) = lower(f.contact))
      or (length(regexp_replace(f.contact, '\D', '', 'g')) >= 9
        and right(regexp_replace(f.contact, '\D', '', 'g'), 9) = right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 9))
    order by o.created_at nulls last
    limit 1
  ) m on true
  order by f.created_at desc
  limit 500;
end
$$;

create function public.admin_set_feedback_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_status not in ('new', 'contacted', 'done') then raise exception 'invalid_status'; end if;
  update private.feedback_messages set status = p_status, status_at = now() where id = p_id;
  if not found then raise exception 'invalid_feedback'; end if;
  insert into private.admin_events(actor_id, action, metadata)
  values (auth.uid(), 'feedback.status', jsonb_build_object('feedback_id', p_id, 'status', p_status));
end
$$;

create function public.admin_feedback_notes(p_id bigint) returns table(
  id uuid, created_at timestamptz, body text, next_contact date, author_email text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select n.id, n.created_at, n.body, n.next_contact, a.email::text
  from private.admin_notes n left join auth.users a on a.id = n.author_id
  where n.feedback_id = p_id
  order by n.created_at desc
  limit 50;
end
$$;

create function public.admin_add_feedback_note(p_id bigint, p_body text, p_next date) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  if p_body is null or length(trim(p_body)) not between 1 and 2000 then raise exception 'invalid_note'; end if;
  if not exists(select 1 from private.feedback_messages where id = p_id) then raise exception 'invalid_feedback'; end if;
  insert into private.admin_notes(feedback_id, author_id, body, next_contact)
  values (p_id, auth.uid(), trim(p_body), p_next);
end
$$;

revoke all on function public.admin_feedback() from public, anon;
revoke all on function public.admin_set_feedback_status(bigint, text) from public, anon;
revoke all on function public.admin_feedback_notes(bigint) from public, anon;
revoke all on function public.admin_add_feedback_note(bigint, text, date) from public, anon;
grant execute on function public.admin_feedback() to authenticated, service_role;
grant execute on function public.admin_set_feedback_status(bigint, text) to authenticated;
grant execute on function public.admin_feedback_notes(bigint) to authenticated;
grant execute on function public.admin_add_feedback_note(bigint, text, date) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261110100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
