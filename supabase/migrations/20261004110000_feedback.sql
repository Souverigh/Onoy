-- Обратная связь со страницы входа (просьба пользователя 04.10.2026): новые
-- магазины приходят по QR с накладных и могут оставить заявку без входа.
-- Сообщения видит только администратор платформы. Данные магазинов не меняются.
begin;

create table private.feedback_messages (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 1 and 120),
  contact text not null check (length(contact) between 3 and 120),
  message text not null check (length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index feedback_messages_created_idx on private.feedback_messages(created_at);
revoke all on private.feedback_messages from public, anon, authenticated;
alter table private.feedback_messages enable row level security;

-- Заявка без входа. Против рассылки спама — не больше 30 сообщений в час на всех.
create function public.send_feedback(p_name text, p_contact text, p_message text) returns void
language plpgsql security definer set search_path='' as $$
begin
  p_name := btrim(coalesce(p_name, ''));
  p_contact := btrim(coalesce(p_contact, ''));
  p_message := btrim(coalesce(p_message, ''));
  if length(p_name) not between 1 and 120 or length(p_contact) not between 3 and 120
    or length(p_message) not between 1 and 2000 then
    raise exception 'invalid_feedback';
  end if;
  if (select count(*) from private.feedback_messages where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many';
  end if;
  insert into private.feedback_messages(name, contact, message) values (p_name, p_contact, p_message);
end
$$;

-- Админка: последние сообщения.
create function public.admin_feedback() returns table(
  id bigint, name text, contact text, message text, created_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() then raise exception 'admin_only'; end if;
  return query
  select f.id, f.name, f.contact, f.message, f.created_at
  from private.feedback_messages f
  order by f.created_at desc
  limit 300;
end
$$;

revoke all on function public.send_feedback(text, text, text) from public;
revoke all on function public.admin_feedback() from public, anon;
grant execute on function public.send_feedback(text, text, text) to anon, authenticated;
grant execute on function public.admin_feedback() to authenticated;

commit;
