-- «Закрыть день» (ТЗ §4 З): снимок итогов дня. Снимок не меняется — записи,
-- внесённые или отменённые за этот день после закрытия, приложение
-- показывает отдельно (сравнивая created_at/reversed_at с closed_at).
-- Новая таблица; существующие данные не трогаются.
begin;

create table public.day_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  day date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  unique (organization_id, id),
  unique (organization_id, day)
);
alter table public.day_closures enable row level security;
revoke all on public.day_closures from anon, authenticated;
grant select on public.day_closures to authenticated;
create policy tenant_read on public.day_closures for select to authenticated
  using (private.is_member(organization_id));

-- Закрыть можно сегодняшний или прошедший день (по Бишкеку), один раз.
-- Повторный вызов (двойное нажатие) возвращает уже сохранённое закрытие и
-- снимок не перезаписывает.
create function public.close_day(p_org uuid, p_day date, p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Bishkek')::date
    or jsonb_typeof(p_snapshot) is distinct from 'object'
    or length(p_snapshot::text) > 200000
  then raise exception 'invalid_day'; end if;
  insert into public.day_closures(organization_id,day,closed_by,snapshot)
  values(p_org,p_day,auth.uid(),p_snapshot)
  on conflict (organization_id,day) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.day_closures where organization_id=p_org and day=p_day;
  else
    insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
    values(p_org,auth.uid(),'day.closed',v_id,jsonb_build_object('day',p_day));
  end if;
  return v_id;
end
$$;
revoke all on function public.close_day(uuid,date,jsonb) from public,anon;
grant execute on function public.close_day(uuid,date,jsonb) to authenticated;

commit;
