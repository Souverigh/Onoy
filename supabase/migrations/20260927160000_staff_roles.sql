-- Сотрудники и роли (ТЗ, тариф «Бизнес»): хозяин (owner) и продавец (staff).
-- Решения пользователя (27.09.2026): доступ — по ссылке-приглашению; только
-- хозяин отменяет записи, делает скидки/возвраты, подтверждает и отклоняет
-- заявки, закрывает день (итоги прячет приложение); управление сотрудниками —
-- тоже только хозяин. Все существующие участники уже role='owner' (default) —
-- их права не меняются. «Кто внёс»: created_by у продаж, приходов и оплат —
-- у старых строк null (не переписываем).
begin;

create function private.is_owner(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.organization_members
    where organization_id=org and user_id=auth.uid() and role='owner'
  );
$$;
revoke all on function private.is_owner(uuid) from public;
grant execute on function private.is_owner(uuid) to authenticated;

-- Кто внёс запись. auth.uid() работает и внутри security definer RPC.
-- Default — отдельной командой: так старые строки остаются null без
-- перезаписи таблицы.
alter table public.sales add column created_by uuid references auth.users(id);
alter table public.purchases add column created_by uuid references auth.users(id);
alter table public.payments add column created_by uuid references auth.users(id);
alter table public.sales alter column created_by set default auth.uid();
alter table public.purchases alter column created_by set default auth.uid();
alter table public.payments alter column created_by set default auth.uid();

-- Имя сотрудника для журнала и итога дня; email — из токена при вступлении.
alter table public.organization_members
  add column display_name text check (display_name is null or length(display_name) between 1 and 80),
  add column email text check (email is null or length(email) <= 254);
-- Хозяин видит всех участников своего магазина, остальные — только себя.
drop policy tenant_read on public.organization_members;
create policy tenant_read on public.organization_members for select to authenticated
  using (user_id=(select auth.uid()) or private.is_owner(organization_id));

-- Приглашения: одноразовая ссылка на 7 дней.
create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  token text not null unique default replace(gen_random_uuid()::text,'-',''),
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  role text not null default 'staff' check (role in ('staff')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index organization_invites_org_idx on public.organization_invites(organization_id, created_at desc);
alter table public.organization_invites enable row level security;
revoke all on public.organization_invites from anon, authenticated;
grant select on public.organization_invites to authenticated;
create policy owner_read on public.organization_invites for select to authenticated
  using (private.is_owner(organization_id));

-- До 5 сотрудников (ТЗ): считаются продавцы и действующие приглашения.
create function public.create_invite(p_org uuid, p_name text) returns text
language plpgsql security definer set search_path='' as $$
declare v_token text;
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if (select count(*) from public.organization_members where organization_id=p_org and role='staff')
     + (select count(*) from public.organization_invites
        where organization_id=p_org and accepted_at is null and revoked_at is null and expires_at > now()) >= 5
  then raise exception 'staff_limit'; end if;
  insert into public.organization_invites(organization_id,display_name,created_by)
  values(p_org,trim(p_name),auth.uid()) returning token into v_token;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'member.invited',jsonb_build_object('name',trim(p_name)));
  return v_token;
end
$$;

create function public.revoke_invite(p_org uuid, p_invite uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.organization_invites set revoked_at=now()
  where organization_id=p_org and id=p_invite and accepted_at is null and revoked_at is null;
  if not found then raise exception 'invalid_invite'; end if;
end
$$;

-- Страница приглашения до входа: только название магазина и имя.
create function public.get_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_invite'; end if;
  select jsonb_build_object('shop_name', o.name, 'display_name', i.display_name)
  into v
  from public.organization_invites i join public.organizations o on o.id=i.organization_id
  where i.token=p_token and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  if v is null then raise exception 'invalid_invite'; end if;
  return v;
end
$$;

create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_invite record; v_email text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_invite'; end if;
  select * into v_invite from public.organization_invites
  where token=p_token and accepted_at is null and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception 'invalid_invite'; end if;
  -- Уже участник (например, сам хозяин открыл ссылку) — роль не понижаем.
  if exists(select 1 from public.organization_members
            where organization_id=v_invite.organization_id and user_id=auth.uid())
  then raise exception 'already_member'; end if;
  v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  insert into public.organization_members(organization_id,user_id,role,display_name,email)
  values(v_invite.organization_id,auth.uid(),v_invite.role,v_invite.display_name,left(v_email,254));
  update public.organization_invites set accepted_by=auth.uid(), accepted_at=now() where id=v_invite.id;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(v_invite.organization_id,auth.uid(),'member.joined',jsonb_build_object('name',v_invite.display_name));
  return v_invite.organization_id;
end
$$;

create function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
  delete from public.organization_members where organization_id=p_org and user_id=p_user and role='staff';
  if not found then raise exception 'invalid_member'; end if;
  insert into public.audit_events(organization_id,actor_id,action,metadata)
  values(p_org,auth.uid(),'member.removed',jsonb_build_object('user',p_user));
end
$$;

-- Имя хозяина/продавца в журнале задаёт хозяин.
create function public.rename_member(p_org uuid, p_user uuid, p_name text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_name'; end if;
  update public.organization_members set display_name=trim(p_name) where organization_id=p_org and user_id=p_user;
  if not found then raise exception 'invalid_member'; end if;
end
$$;

revoke all on function public.create_invite(uuid,text) from public,anon;
revoke all on function public.revoke_invite(uuid,uuid) from public,anon;
revoke all on function public.accept_invite(text) from public,anon;
revoke all on function public.remove_member(uuid,uuid) from public,anon;
revoke all on function public.rename_member(uuid,uuid,text) from public,anon;
revoke all on function public.get_invite(text) from public;
grant execute on function public.create_invite(uuid,text) to authenticated;
grant execute on function public.revoke_invite(uuid,uuid) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.remove_member(uuid,uuid) to authenticated;
grant execute on function public.rename_member(uuid,uuid,text) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Только хозяин: отмена записей, заявки клиентов, закрытие дня, скидки.
-- Тела — как в debt_ledger.sql / day_closures.sql / adjustments.sql, проверка
-- участника заменена на проверку хозяина.

create or replace function public.reverse_sale(p_org uuid, p_sale uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.sales set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=trim(p_comment)
  where organization_id=p_org and id=p_sale and reversed_at is null;
  if not found then raise exception 'invalid_sale'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'sale.reversed',p_sale,jsonb_build_object('comment',trim(p_comment)));
end
$$;

create or replace function public.reverse_purchase(p_org uuid, p_purchase uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.purchases set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=trim(p_comment)
  where organization_id=p_org and id=p_purchase and reversed_at is null;
  if not found then raise exception 'invalid_purchase'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'purchase.reversed',p_purchase,jsonb_build_object('comment',trim(p_comment)));
end
$$;

create or replace function public.reverse_payment(p_org uuid, p_payment uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.payments set reversed_at=now(),reversed_by=auth.uid(),reversal_comment=trim(p_comment)
  where organization_id=p_org and id=p_payment and reversed_at is null and status='confirmed';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.reversed',p_payment,jsonb_build_object('comment',trim(p_comment)));
end
$$;

create or replace function public.confirm_payment_claim(p_org uuid, p_payment uuid, p_amount text) returns void
language plpgsql security definer set search_path='' as $$
declare v_amount numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  v_amount := coalesce(p_amount, (select amount::text from public.payments where organization_id=p_org and id=p_payment))::numeric;
  if v_amount<=0 or v_amount>=100000000000000 then raise exception 'invalid_payment'; end if;
  update public.payments set status='confirmed', amount=v_amount
  where organization_id=p_org and id=p_payment and status='pending';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_confirmed',p_payment,jsonb_build_object('amount',v_amount::text));
end
$$;

create or replace function public.reject_payment_claim(p_org uuid, p_payment uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_comment is null or length(trim(p_comment))=0 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  update public.payments set status='rejected', reject_comment=trim(p_comment)
  where organization_id=p_org and id=p_payment and status='pending';
  if not found then raise exception 'invalid_payment'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'payment.claim_rejected',p_payment,jsonb_build_object('comment',trim(p_comment)));
end
$$;

create or replace function public.close_day(p_org uuid, p_day date, p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
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

create or replace function public.commit_adjustment(
  p_org uuid, p_direction text, p_party uuid, p_kind text, p_amount text, p_note text,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_hash text; v_existing uuid; v_existing_hash text; v_id uuid; v_amount numeric;
  v_customer uuid; v_supplier uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_idempotency_key is null or p_party is null
    or p_direction not in ('incoming','outgoing')
    or p_kind not in ('discount','return')
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
  then raise exception 'invalid_adjustment'; end if;
  if length(trim(coalesce(p_note,''))) = 0 or length(p_note) > 500
  then raise exception 'invalid_note'; end if;
  v_amount := p_amount::numeric;
  if v_amount <= 0 or v_amount >= 100000000000000 then raise exception 'invalid_adjustment'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not exists (
    select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid()
  ) then raise exception 'not_a_member'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;

  v_hash := md5(jsonb_build_object(
    'direction',p_direction,'party',p_party,'kind',p_kind,'amount',v_amount::text,'note',trim(p_note)
  )::text);
  select id,request_hash into v_existing,v_existing_hash
  from public.payments where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception 'idempotency_conflict'; end if;
    return v_existing;
  end if;

  if p_direction='incoming' then
    if not exists(select 1 from public.customers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_customer := p_party;
  else
    if not exists(select 1 from public.suppliers where organization_id=p_org and id=p_party)
    then raise exception 'invalid_party'; end if;
    v_supplier := p_party;
  end if;

  insert into public.payments(
    organization_id,customer_id,supplier_id,direction,amount,status,kind,note,
    idempotency_key,request_hash
  ) values(
    p_org,v_customer,v_supplier,p_direction,v_amount,'confirmed',p_kind,trim(p_note),
    p_idempotency_key,v_hash
  ) returning id into v_id;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'adjustment.'||p_kind,v_id,
    jsonb_build_object('amount',v_amount::text,'direction',p_direction,'note',left(trim(p_note),500)));
  return v_id;
end
$$;

commit;
