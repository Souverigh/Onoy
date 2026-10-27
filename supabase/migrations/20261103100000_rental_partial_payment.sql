-- Прокат: частичная оплата (пользователь 26.10.2026: «1000?» в тетради —
-- заплатил часть). Выдача с p_paid_now: продажа на всю сумму в долг и сразу
-- оплата наличными на внесённую часть (commit_payment) — долг клиента
-- становится остатком, касса видит внесённое. Отмена выдачи отменяет и эту
-- оплату.
-- Новая колонка (nullable) и пересозданные функции; данные не меняются.
begin;

alter table public.rentals add column payment_id uuid;
alter table public.rentals add constraint rentals_payment_fkey
  foreign key (organization_id, payment_id) references public.payments(organization_id, id);

drop function public.issue_rental(uuid,uuid,jsonb,integer,text,boolean,text,text,text,text,uuid);
create function public.issue_rental(
  p_org uuid, p_customer uuid, p_items jsonb, p_days integer, p_amount text, p_paid boolean,
  p_collateral_kind text, p_collateral_note text, p_deposit text, p_note text, p_idempotency_key uuid,
  p_paid_now text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_item jsonb; v_n integer := 0; v_product uuid; v_amount numeric; v_deposit numeric;
  v_currency text; v_sale uuid; v_names text; v_part numeric; v_payment uuid;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_collateral text := nullif(trim(coalesce(p_collateral_note,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform 1 from public.organizations where id=p_org for update;
  if not found or not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  select id into v_id from public.rentals where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;

  if p_idempotency_key is null or p_customer is null or p_paid is null
    or p_days is null or p_days not between 1 and 365
    or coalesce(p_amount,'') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    or p_collateral_kind is null or p_collateral_kind not in ('passport','license','id_card','other','none')
    or length(coalesce(v_collateral,'')) > 100 or length(coalesce(v_note,'')) > 500
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50
  then raise exception 'invalid_rental'; end if;
  if p_deposit is not null and p_deposit <> '' then
    if p_deposit !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' then raise exception 'invalid_rental'; end if;
    v_deposit := nullif(p_deposit::numeric, 0);
  end if;
  v_amount := p_amount::numeric;
  -- Часть сразу: только при «в долг», меньше всей суммы; вся сумма — это «оплатил».
  if p_paid_now is not null and p_paid_now <> '' then
    if p_paid_now !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$' or p_paid then raise exception 'invalid_rental'; end if;
    v_part := nullif(p_paid_now::numeric, 0);
    if v_part is not null and v_part >= v_amount then raise exception 'invalid_rental'; end if;
  end if;
  if not exists(select 1 from public.customers where organization_id=p_org and id=p_customer and merged_into_id is null)
  then raise exception 'invalid_customer'; end if;
  select coalesce(currency,'KGS') into v_currency from public.organizations where id=p_org;

  insert into public.rentals(
    organization_id, customer_id, days, due_on, collateral_kind, collateral_note, deposit, note, idempotency_key
  ) values (
    p_org, p_customer, p_days, (now() at time zone 'Asia/Bishkek')::date + p_days,
    p_collateral_kind, v_collateral, v_deposit, v_note, p_idempotency_key
  ) returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item->>'product','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_item->>'price','') !~ '^[0-9]{1,14}(\.[0-9]{1,2})?$'
    then raise exception 'invalid_rental'; end if;
    v_product := (v_item->>'product')::uuid;
    if not exists(select 1 from public.products where organization_id=p_org and id=v_product and archived_at is null)
    then raise exception 'invalid_product'; end if;
    v_n := v_n + 1;
    insert into public.rental_items(organization_id, rental_id, n, product_id, price_per_day)
    values (p_org, v_id, v_n, v_product, (v_item->>'price')::numeric);
  end loop;

  if exists(
    select 1 from public.rental_items i
    join public.product_balances b on b.organization_id = i.organization_id and b.id = i.product_id
    where i.organization_id = p_org and i.rental_id = v_id
      and b.stock::numeric < (
        select count(*) from public.rental_items o
        join public.rentals r on r.organization_id = o.organization_id and r.id = o.rental_id
        where o.organization_id = p_org and o.product_id = i.product_id
          and o.returned_at is null and r.reversed_at is null)
  ) then raise exception 'item_busy'; end if;

  if v_amount > 0 then
    v_sale := public.commit_sale(p_org, p_customer, v_amount::text, p_paid, private.rental_key(p_idempotency_key, 'sale'));
    select string_agg(p.name, ', ' order by i.n) into v_names
    from public.rental_items i join public.products p on p.organization_id = i.organization_id and p.id = i.product_id
    where i.organization_id = p_org and i.rental_id = v_id;
    update public.sales set note = left('Прокат на ' || p_days || ' дн.: ' || v_names, 500)
    where organization_id = p_org and id = v_sale;
    update public.rentals set sale_id = v_sale where organization_id = p_org and id = v_id;
  end if;
  if v_part is not null then
    v_payment := public.commit_payment(p_org, 'incoming', p_customer, v_part::text, null,
      private.rental_key(p_idempotency_key, 'payment'), null, null, null, null, null, 'cash');
    update public.payments set note = 'Прокат: часть оплаты' where organization_id = p_org and id = v_payment;
    update public.rentals set payment_id = v_payment where organization_id = p_org and id = v_id;
  end if;
  if v_deposit is not null then
    insert into public.cash_moves(organization_id, direction, amount, currency, note, idempotency_key, rental_id)
    values (p_org, 'in', v_deposit, v_currency, 'Залог за прокат', private.rental_key(p_idempotency_key, 'deposit'), v_id);
  end if;

  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.issued', v_id, jsonb_build_object(
    'customer', p_customer, 'items', v_n, 'days', p_days, 'amount', v_amount::text,
    'paid_now', v_part::text, 'deposit', v_deposit::text, 'collateral', p_collateral_kind));
  return v_id;
end
$$;
revoke all on function public.issue_rental(uuid,uuid,jsonb,integer,text,boolean,text,text,text,text,uuid,text) from public, anon;
grant execute on function public.issue_rental(uuid,uuid,jsonb,integer,text,boolean,text,text,text,text,uuid,text) to authenticated;

-- Отменить выдачу: как раньше, и оплата части — тоже.
create or replace function public.reverse_rental(p_org uuid, p_rental uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
declare v_rental public.rentals; v_comment text := nullif(trim(coalesce(p_comment,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_comment is null or length(v_comment) > 500 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select * into v_rental from public.rentals where organization_id=p_org and id=p_rental for update;
  if not found or v_rental.reversed_at is not null then raise exception 'invalid_rental'; end if;
  update public.sales set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = 'Прокат отменён: ' || v_comment
  where organization_id = p_org and id in (v_rental.sale_id, v_rental.extra_sale_id) and reversed_at is null;
  update public.payments set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = 'Прокат отменён: ' || v_comment
  where organization_id = p_org and id = v_rental.payment_id and reversed_at is null;
  update public.cash_moves set reversed_at = now(), reversed_by = auth.uid()
  where organization_id = p_org and rental_id = p_rental and reversed_at is null;
  update public.rental_items set returned_at = coalesce(returned_at, now()), returned_by = coalesce(returned_by, auth.uid())
  where organization_id = p_org and rental_id = p_rental;
  update public.rentals set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = v_comment
  where organization_id = p_org and id = p_rental;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.reversed', p_rental, jsonb_build_object('comment', v_comment));
end
$$;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261103100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
