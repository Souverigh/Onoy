-- Смена email в «Настройках» (просьба пользователя 02.10.2026): копия email
-- в organization_members (берётся из токена при вступлении, видна владельцу в
-- «Сотрудниках») обновляется, когда Supabase подтвердил новый адрес. Пустые
-- копии (владельцы, создавшие магазин до этого) заполняются из auth.users.
begin;

create function private.sync_member_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.organization_members set email=left(new.email,254)
  where user_id=new.id and email is distinct from left(new.email,254);
  return null;
end
$$;
revoke all on function private.sync_member_email() from public, anon, authenticated;
create trigger sync_member_email after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function private.sync_member_email();

update public.organization_members m set email=left(u.email,254)
from auth.users u
where u.id=m.user_id and u.email is not null and m.email is distinct from left(u.email,254);

commit;
