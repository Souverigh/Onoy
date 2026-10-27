-- Прокат: защита (разбор архитектуры с пользователем 26.10.2026).
--   1. Продажу за прокат (и доплату за лишние дни) нельзя отменить или
--      исправить мимо проката — «Отменить - ошиблись», «Отменить запись»,
--      «Исправить»: иначе деньги отменены, а выдача «на руках» и ссылается
--      на отменённую продажу. Отменяется только вместе с выдачей
--      (reverse_rental: сначала помечает выдачу, потом её продажи).
--   2. Выдача — только клиенту с долгом в валюте магазина: сумма проката в
--      валюте магазина и в долг другой валюты записалась бы неверно.
-- Новые функция и триггер, пересозданные функции; данные не меняются.
begin;

create function private.guard_rental_sale() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(
    select 1 from public.rentals
    where organization_id = new.organization_id and (sale_id = new.id or extra_sale_id = new.id) and reversed_at is null
  ) then raise exception 'rental_sale'; end if;
  return new;
end
$$;
revoke all on function private.guard_rental_sale() from public, anon, authenticated;
create trigger guard_rental_sale before update of reversed_at on public.sales
  for each row when (old.reversed_at is null and new.reversed_at is not null)
  execute function private.guard_rental_sale();

-- Отменить выдачу: сначала выдача, потом её продажи (их защита видит, что выдача отменена).
create or replace function public.reverse_rental(p_org uuid, p_rental uuid, p_comment text) returns void
language plpgsql security definer set search_path='' as $$
declare v_rental public.rentals; v_comment text := nullif(trim(coalesce(p_comment,'')),'');
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_comment is null or length(v_comment) > 500 then raise exception 'invalid_comment'; end if;
  if not private.is_owner(p_org) then raise exception 'owner_only'; end if;
  select * into v_rental from public.rentals where organization_id=p_org and id=p_rental for update;
  if not found or v_rental.reversed_at is not null then raise exception 'invalid_rental'; end if;
  update public.rentals set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = v_comment
  where organization_id = p_org and id = p_rental;
  update public.sales set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = 'Прокат отменён: ' || v_comment
  where organization_id = p_org and id in (v_rental.sale_id, v_rental.extra_sale_id) and reversed_at is null;
  update public.payments set reversed_at = now(), reversed_by = auth.uid(), reversal_comment = 'Прокат отменён: ' || v_comment
  where organization_id = p_org and id = v_rental.payment_id and reversed_at is null;
  update public.cash_moves set reversed_at = now(), reversed_by = auth.uid()
  where organization_id = p_org and rental_id = p_rental and reversed_at is null;
  update public.rental_items set returned_at = coalesce(returned_at, now()), returned_by = coalesce(returned_by, auth.uid())
  where organization_id = p_org and rental_id = p_rental;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'rental.reversed', p_rental, jsonb_build_object('comment', v_comment));
end
$$;

-- Выдача только клиенту с долгом в валюте магазина: проверка до всего остального.
create function private.check_rental_currency(p_org uuid, p_customer uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if private.party_currency(p_org, 'customers', p_customer)
     is distinct from (select coalesce(currency,'KGS') from public.organizations where id = p_org)
  then raise exception 'rental_currency'; end if;
end
$$;
revoke all on function private.check_rental_currency(uuid,uuid) from public, anon, authenticated;

create function private.rentals_check_currency() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.check_rental_currency(new.organization_id, new.customer_id);
  return new;
end
$$;
revoke all on function private.rentals_check_currency() from public, anon, authenticated;
create trigger check_currency before insert on public.rentals
  for each row execute function private.rentals_check_currency();

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261104100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
