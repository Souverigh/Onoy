-- Товарная накладная по образцу магазина: номер, долг покупателя после этой
-- накладной, продавец и телефон покупателя. Только функции — данные не меняются.
begin;

-- Номер — порядковый среди продаж магазина (без вводных остатков), по времени
-- записи: отдельной колонки нет, поэтому старые накладные тоже получают номер.
-- Долг после накладной — как в customer_balances, но только записи до этой
-- продажи включительно (оплаты — по дате оплаты).
create function private.sale_invoice_info(p_org uuid, p_sale uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object(
      'number', (
        select count(*) from public.sales x
        where x.organization_id=s.organization_id and not x.is_opening
          and (x.created_at, x.id) <= (s.created_at, s.id)
      ),
      'debt_after', (
        coalesce((
          select sum(x.total) from public.sales x
          where x.organization_id=s.organization_id and x.customer_id=s.customer_id
            and x.status='posted' and not x.paid_immediately and x.reversed_at is null
            and (x.occurred_at, x.created_at, x.id) <= (s.occurred_at, s.created_at, s.id)
        ),0)::numeric(16,2)
        - coalesce((
          select sum(p.amount) from public.payments p
          where p.organization_id=s.organization_id and p.customer_id=s.customer_id
            and p.status='confirmed' and p.reversed_at is null and p.occurred_at <= s.occurred_at
        ),0)::numeric(16,2)
      )::text,
      'customer_phone', c.phone,
      'seller_name', coalesce(m.display_name, (
        select o.display_name from public.organization_members o
        where o.organization_id=s.organization_id and o.role='owner' and o.display_name is not null
        order by o.created_at limit 1
      ))
    )
    from public.sales s
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    left join public.organization_members m on m.organization_id=s.organization_id and m.user_id=s.created_by
    where s.organization_id=p_org and s.id=p_sale
  ), '{}'::jsonb)
$$;
revoke all on function private.sale_invoice_info(uuid,uuid) from public, anon, authenticated;

-- Для PDF в приложении: любой участник магазина (имя продавца видно и
-- сотруднику, хотя список участников ему закрыт).
create function public.sale_invoice_info(p_org uuid, p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'not_a_member'; end if;
  return private.sale_invoice_info(p_org, p_sale);
end
$$;
revoke all on function public.sale_invoice_info(uuid,uuid) from public, anon;
grant execute on function public.sale_invoice_info(uuid,uuid) to authenticated;

-- Накладная по ссылке клиента: тело — как в warehouse.sql, плюс те же поля.
create or replace function public.get_invoice_by_token(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_sale record; v_currency text; v_shop record; v_result jsonb;
begin
  select l.organization_id, l.customer_id, c.name as customer_name into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if found then
    v_currency := private.party_currency(v_link.organization_id,'customers',v_link.customer_id);
    select s.* into v_sale from public.sales s
    where s.organization_id=v_link.organization_id and s.id=p_sale and s.customer_id=v_link.customer_id
      and s.status='posted' and s.reversed_at is null and not s.is_opening
      and exists(select 1 from public.sale_items i where i.organization_id=s.organization_id and i.sale_id=s.id);
    if found then
      select o.name, o.phone into v_shop from public.organizations o where o.id=v_link.organization_id;
      v_result := jsonb_build_object(
        'shop_name', v_shop.name,
        'shop_phone', v_shop.phone,
        'customer_name', v_link.customer_name,
        'total', coalesce(v_sale.original_amount, v_sale.total)::text,
        'currency', coalesce(v_sale.original_currency, v_currency, 'KGS'),
        'occurred_at', v_sale.occurred_at,
        'paid_immediately', v_sale.paid_immediately,
        'items', true,
        'lines', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'n', coalesce(i.n, 0), 'name_raw', i.name_snapshot, 'qty', i.qty::text, 'unit', coalesce(i.unit,'шт'),
            'price', i.price::text, 'sum', i.line_total::text) order by i.n, i.created_at), '[]'::jsonb)
          from public.sale_items i where i.organization_id=v_sale.organization_id and i.sale_id=v_sale.id
        )
      );
    end if;
  end if;
  -- Проверки токена и продажи — в unchecked: там же отказ invalid_*.
  if v_result is null then
    v_result := private.get_invoice_by_token_unchecked(p_token, p_sale)
      || jsonb_build_object('currency', coalesce(v_currency,'KGS'));
  end if;
  return v_result
    || private.sale_invoice_info(v_link.organization_id, p_sale)
    || jsonb_build_object('debt_currency', coalesce(v_currency,'KGS'));
end
$$;

commit;
