-- ТЗ §13: при неоплате — 7 льготных дней, затем «только просмотр»; данные не
-- удаляются, ссылки клиентов продолжают открываться («блокировка не должна
-- бить по клиентам магазина»). Исправляет platform_admin.sql: там блокировка
-- закрывала страницу клиента и включалась только вручную.
-- «Только просмотр» = заблокирован админом ИЛИ оплачено до (paid_until) + 7
-- дней уже прошло. paid_until = null (пилот, оплата не отмечена) — без
-- ограничений. Данные не меняются.
begin;

create function private.shop_read_only(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organizations o
    where o.id=org and (
      o.blocked_at is not null
      or (o.paid_until is not null and o.paid_until + 7 < (now() at time zone 'Asia/Bishkek')::date)
    )
  );
$$;
revoke all on function private.shop_read_only(uuid) from public;
grant execute on function private.shop_read_only(uuid) to authenticated;

-- Триггер на таблицах данных магазина — тот же, условие шире.
create or replace function private.reject_blocked_shop() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Клиент по ссылке (без входа): заявка «Я оплатил» и её фото долг не
  -- меняют — пропускаем, страница клиента должна работать и в этом режиме.
  if auth.uid() is null then return new; end if;
  if private.shop_read_only(new.organization_id) then raise exception 'shop_blocked'; end if;
  return new;
end
$$;

-- Страница клиента и PDF по ссылке — снова без проверки блокировки.
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return private.get_statement_by_token_unchecked(p_token);
end
$$;
create or replace function public.get_invoice_by_token(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return private.get_invoice_by_token_unchecked(p_token, p_sale);
end
$$;

commit;
