-- Расходы магазина: аренда, зарплата, доставка и т.п. Долги не меняют —
-- отдельная таблица, балансы, акт сверки и давность долга их не видят.
-- В Итоге дня уменьшают деньги за день. Вносит любой участник магазина;
-- отменяет владелец с причиной (или автор в первые 2 минуты — undo_recent).
-- Фото (чек, квитанция) необязательно: файлы лежат в том же хранилище
-- (папка <org>/expense/), в documents не попадают и не распознаются.
-- Новая таблица; существующие данные не трогаются.
begin;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  -- День расхода по Бишкеку: по умолчанию сегодня, можно выбрать другой.
  spent_on date not null,
  amount numeric(16,2) not null check (amount > 0 and amount < 1e14),
  -- Валюта магазина на момент записи — сумма не «переедет» в другую валюту.
  currency text not null check (currency in ('KGS','USD','RUB')),
  category text not null check (category in
    ('rent','salary','transport','utilities','taxes','supplies','food','other')),
  note text check (note is null or length(note) <= 500),
  -- [{ "path": "<org>/expense/…", "mime": "image/jpeg" }], до 5 файлов.
  photos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 5),
  idempotency_key uuid not null,
  request_hash text,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_comment text,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  -- «Прочее» — только с комментарием: иначе непонятно, на что ушли деньги.
  constraint expenses_other_note check (category <> 'other' or length(trim(coalesce(note,''))) > 0)
);
create index expenses_org_day_idx on public.expenses(organization_id, spent_on);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;
create policy tenant_read on public.expenses for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.expenses
  for each row execute function private.reject_blocked_shop();

create function public.commit_expense(
  p_org uuid, p_amount text, p_category text, p_note text, p_spent_on date,
  p_photos jsonb, p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_id uuid; v_amount numeric;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_photos jsonb := coalesce(p_photos,'[]'::jsonb);
  v_today date := (now() at time zone 'Asia/Bishkek')::date;
  v_day date := coalesce(p_spent_on, (now() at time zone 'Asia/Bishkek')::date);
  v_currency text;
  v_photo jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or p_category not in ('rent','salary','transport','utilities','taxes','supplies','food','other')
  then raise exception 'invalid_expense'; end if;
  v_amount := p_amount::numeric;
  if v_amount <= 0 or v_amount >= 100000000000000 then raise exception 'invalid_expense'; end if;
  if length(coalesce(v_note,'')) > 500 or (p_category = 'other' and v_note is null)
  then raise exception 'invalid_note'; end if;
  if v_day > v_today or v_day < v_today - 366 then raise exception 'invalid_date'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  -- Файлы — только из папки своего магазина.
  if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) > 5
  then raise exception 'invalid_photo'; end if;
  for v_photo in select * from jsonb_array_elements(v_photos) loop
    if jsonb_typeof(v_photo) <> 'object'
      or coalesce(v_photo->>'path','') not like p_org::text || '/expense/%'
      or length(v_photo->>'path') > 300
      or coalesce(v_photo->>'mime','') !~ '^(image/[a-z0-9.+-]+|application/pdf)$'
    then raise exception 'invalid_photo'; end if;
  end loop;

  v_hash := md5(jsonb_build_object(
    'amount',v_amount::text,'category',p_category,'note',v_note,'day',v_day,'photos',v_photos
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.expenses where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  select currency into v_currency from public.organizations where id=p_org;
  insert into public.expenses(
    organization_id,spent_on,amount,currency,category,note,photos,idempotency_key,request_hash
  ) values(
    p_org,v_day,v_amount,coalesce(v_currency,'KGS'),p_category,v_note,v_photos,p_idempotency_key,v_hash
  ) returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'expense.created',v_id,
    jsonb_build_object('amount',v_amount::text,'category',p_category,'day',v_day));
  return v_id;
end
$$;
revoke all on function public.commit_expense(uuid,text,text,text,date,jsonb,uuid) from public,anon;
grant execute on function public.commit_expense(uuid,text,text,text,date,jsonb,uuid) to authenticated;

-- Отмена — как у остальных записей: владелец, с причиной; запись остаётся
-- в истории как отменённая.
create function public.reverse_expense(p_org uuid, p_expense uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.expenses set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=left(trim(p_comment),500)
  where organization_id=p_org and id=p_expense and reversed_at is null;
  if not found then raise exception 'invalid_expense'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'expense.reversed',p_expense,jsonb_build_object('comment',trim(p_comment)));
end
$$;
revoke all on function public.reverse_expense(uuid,uuid,text) from public,anon;
grant execute on function public.reverse_expense(uuid,uuid,text) to authenticated;

-- «Отменить — ошиблись» на экране результата: тело — как в undo_recent.sql,
-- плюс расходы.
create or replace function public.undo_recent(p_org uuid, p_kind text, p_id uuid) returns void
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
  elsif p_kind = 'expense' then
    update public.expenses set reversed_at=now(), reversed_by=auth.uid(), reversal_comment=v_comment
    where organization_id=p_org and id=p_id and created_by=auth.uid()
      and reversed_at is null and created_at > now() - interval '2 minutes';
  else
    raise exception 'invalid_kind';
  end if;
  if not found then raise exception 'undo_expired'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),p_kind||'.undone',p_id,'{}'::jsonb);
end
$$;

commit;
