-- Сортировка клиентов и поставщиков: «недавние» (последняя продажа, оплата,
-- товар или правка карточки — сверху), «по долгу», «новые». Только новые
-- колонки (nullable), триггеры и представления — существующие данные не
-- меняются. updated_at у старых записей пустой: для них «недавнее» —
-- последняя запись или дата создания.
begin;

alter table public.customers add column updated_at timestamptz;
alter table public.suppliers add column updated_at timestamptz;

-- Правка карточки (имя, телефон, обещание, архив) — время изменения.
create function private.touch_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger customers_touch_updated_at before update on public.customers
  for each row execute function private.touch_updated_at();
create trigger suppliers_touch_updated_at before update on public.suppliers
  for each row execute function private.touch_updated_at();

-- Списки для страниц «Клиенты» / «Поставщики»: долг числом (balance —
-- текст, по нему не отсортировать) и время последнего изменения.
create view public.customer_list
with (security_invoker=true) as
  select b.*,
    b.balance::numeric as balance_value,
    greatest(
      b.created_at,
      (select c.updated_at from public.customers c where c.organization_id=b.organization_id and c.id=b.id),
      (select max(s.created_at) from public.sales s where s.organization_id=b.organization_id and s.customer_id=b.id),
      (select max(p.created_at) from public.payments p where p.organization_id=b.organization_id and p.customer_id=b.id)
    ) as last_activity_at
  from public.customer_balances b;

create view public.supplier_list
with (security_invoker=true) as
  select b.*,
    b.balance::numeric as balance_value,
    greatest(
      b.created_at,
      (select c.updated_at from public.suppliers c where c.organization_id=b.organization_id and c.id=b.id),
      (select max(s.created_at) from public.purchases s where s.organization_id=b.organization_id and s.supplier_id=b.id),
      (select max(p.created_at) from public.payments p where p.organization_id=b.organization_id and p.supplier_id=b.id)
    ) as last_activity_at
  from public.supplier_balances b;

revoke all on public.customer_list, public.supplier_list from anon, authenticated;
grant select on public.customer_list, public.supplier_list to authenticated;

commit;
