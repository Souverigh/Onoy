-- Отменили продажу по заказу из каталога — заказ снова «Новый» (замечание
-- тестировщика 26.10.2026: заказ оставался «Продан», кнопки «Сделать
-- продажу» не было, клиент в «Мои заказы» видел «Продан»).
--   - триггер: продажу отменили — её заказ возвращается в новые, без продажи
--     и черновика, с записью в audit_events;
--   - reopen_catalog_order: для заказов, чью продажу отменили до этой
--     миграции, — «Вернуть в новые» со страницы заказа (данные сами не
--     переписываем).
-- Новые функции и триггер; существующие данные не меняются.
begin;

create function private.reopen_catalog_order_on_sale_reversal() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  for v_id in
    update public.catalog_orders
    set status = 'new', sale_id = null, draft_id = null, handled_by = auth.uid(), handled_at = now()
    where organization_id = new.organization_id and sale_id = new.id and status = 'sold'
    returning id
  loop
    insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
    values (new.organization_id, auth.uid(), 'catalog_order.reopened', v_id, jsonb_build_object('sale', new.id));
  end loop;
  return new;
end
$$;
revoke all on function private.reopen_catalog_order_on_sale_reversal() from public;

create trigger reopen_catalog_order after update of reversed_at on public.sales
  for each row when (old.reversed_at is null and new.reversed_at is not null)
  execute function private.reopen_catalog_order_on_sale_reversal();

-- «Вернуть в новые» проданный заказ — только если его продажа отменена.
create function public.reopen_catalog_order(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_sale uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  update public.catalog_orders o
  set status = 'new', sale_id = null, draft_id = null, handled_by = auth.uid(), handled_at = now()
  from public.sales s
  where o.organization_id = p_org and o.id = p_id and o.status = 'sold'
    and s.organization_id = o.organization_id and s.id = o.sale_id and s.reversed_at is not null
  returning s.id into v_sale;
  if v_sale is null then raise exception 'order_handled'; end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_id, metadata)
  values (p_org, auth.uid(), 'catalog_order.reopened', p_id, jsonb_build_object('sale', v_sale));
end
$$;
revoke all on function public.reopen_catalog_order(uuid,uuid) from public, anon;
grant execute on function public.reopen_catalog_order(uuid,uuid) to authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261101100000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
