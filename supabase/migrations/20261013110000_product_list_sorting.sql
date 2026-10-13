-- Сортировка склада: «мало осталось» (остаток числом — в product_balances
-- он текстом) и «недавно приходили» (последний приход товара). Только
-- новое представление — данные не меняются.
begin;

create view public.product_list
with (security_invoker=true) as
  select b.*,
    b.stock::numeric as stock_value,
    (
      select max(m.created_at) from public.inventory_movements m
      join public.purchases pu on pu.organization_id=m.organization_id and pu.id=m.purchase_id
      where m.organization_id=b.organization_id and m.product_id=b.id
        and m.reason='purchase' and pu.reversed_at is null
    ) as last_received_at
  from public.product_balances b;

revoke all on public.product_list from anon, authenticated;
grant select on public.product_list to authenticated;

commit;
