-- Касса как в 1С, но просто (просьба пользователя 17.10.2026): «Забрал из
-- кассы» (выручку домой, в банк) и «Положил в кассу» (размен). Долги, продажи
-- и отчёты о продажах эти записи не меняют — только наличные в кассе.
-- Остаток на утро — из итога прошлого закрытого дня (снимок day_closures).
-- Новая таблица и функции; существующие данные не трогаются.
begin;

create table public.cash_moves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  occurred_at timestamptz not null default now(),
  direction text not null check (direction in ('out','in')),
  amount numeric(16,2) not null check (amount > 0 and amount < 1e14),
  -- Валюта магазина на момент записи — касса ведётся в ней.
  currency text not null check (currency in ('KGS','USD','RUB')),
  note text check (note is null or length(note) <= 200),
  idempotency_key uuid not null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  unique (organization_id, id),
  unique (organization_id, idempotency_key)
);
create index cash_moves_org_time_idx on public.cash_moves(organization_id, occurred_at);
alter table public.cash_moves enable row level security;
revoke all on public.cash_moves from anon, authenticated;
grant select on public.cash_moves to authenticated;
create policy tenant_read on public.cash_moves for select to authenticated
  using (private.is_member(organization_id));
create trigger reject_blocked_shop before insert or update on public.cash_moves
  for each row execute function private.reject_blocked_shop();

-- Записать: только владелец (касса — его деньги), сейчас. Повтор с тем же
-- ключом — та же запись.
create function public.commit_cash_move(
  p_org uuid, p_direction text, p_amount text, p_note text, p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_amount numeric; v_note text := nullif(trim(coalesce(p_note,'')),''); v_currency text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_idempotency_key is null or p_direction not in ('out','in')
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_cash_move'; end if;
  v_amount := p_amount::numeric;
  if v_amount <= 0 then raise exception 'invalid_cash_move'; end if;
  if length(coalesce(v_note,'')) > 200 then raise exception 'invalid_note'; end if;
  select id into v_id from public.cash_moves where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  select currency into v_currency from public.organizations where id=p_org;
  insert into public.cash_moves(organization_id, direction, amount, currency, note, idempotency_key)
  values (p_org, p_direction, v_amount, coalesce(v_currency,'KGS'), v_note, p_idempotency_key)
  returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), 'cash_move.created', v_id,
    jsonb_build_object('direction', p_direction, 'amount', v_amount::text, 'note', v_note));
  return v_id;
end
$$;

-- Отменить: владелец; запись остаётся в истории отменённой.
create function public.reverse_cash_move(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.cash_moves set reversed_at=now(), reversed_by=auth.uid()
  where organization_id=p_org and id=p_id and reversed_at is null;
  if not found then raise exception 'invalid_cash_move'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), 'cash_move.reversed', p_id, '{}'::jsonb);
end
$$;

revoke all on function public.commit_cash_move(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.commit_cash_move(uuid,text,text,text,uuid) to authenticated;
revoke all on function public.reverse_cash_move(uuid,uuid) from public,anon;
grant execute on function public.reverse_cash_move(uuid,uuid) to authenticated;

commit;
