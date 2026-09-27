-- Накладная клиенту по ссылке (ТЗ §4 Б): PDF продажи открывается по токену
-- клиента без входа. Отдаётся только сверенная накладная (документ
-- «оцифрована»), не отменённая и не перенос из тетради — и только своему
-- клиенту. Новых таблиц нет, существующие данные не трогаются.
begin;

create function public.get_invoice_by_token(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_sale record; v_shop_name text; v_shop_phone text;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select l.organization_id, l.customer_id, c.name as customer_name
  into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;

  select s.id, s.total, s.occurred_at, s.paid_immediately, s.document_id
  into v_sale
  from public.sales s
  join public.documents d on d.organization_id=s.organization_id and d.id=s.document_id
  where s.organization_id=v_link.organization_id and s.id=p_sale
    and s.customer_id=v_link.customer_id and s.status='posted'
    and s.reversed_at is null and not s.is_opening and d.status='digitized';
  if not found then raise exception 'invalid_invoice'; end if;

  select o.name, o.phone into v_shop_name, v_shop_phone from public.organizations o where o.id=v_link.organization_id;
  return jsonb_build_object(
    'shop_name', v_shop_name,
    'shop_phone', v_shop_phone,
    'customer_name', v_link.customer_name,
    'total', v_sale.total::text,
    'occurred_at', v_sale.occurred_at,
    'paid_immediately', v_sale.paid_immediately,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'n', n, 'name_raw', name_raw, 'qty', qty::text, 'unit', unit,
        'price', price::text, 'sum', sum::text) order by n), '[]'::jsonb)
      from public.document_lines
      where organization_id=v_link.organization_id and document_id=v_sale.document_id
    )
  );
end
$$;
revoke all on function public.get_invoice_by_token(text,uuid) from public,anon,authenticated;
grant execute on function public.get_invoice_by_token(text,uuid) to anon, authenticated;

-- Страница клиента: у продажи пометка invoice — есть ли сверенная накладная
-- (тогда рядом ссылка «Накладная PDF»). Тело — как в opening_balances.sql.
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_shop_name text; v_shop_phone text; v_balance text;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select l.*, c.name as customer_name, c.phone as customer_phone
  into v_link
  from public.share_links l join public.customers c on c.organization_id=l.organization_id and c.id=l.customer_id
  where l.token=p_token and l.revoked_at is null;
  if not found then raise exception 'invalid_token'; end if;
  select o.name, o.phone into v_shop_name, v_shop_phone from public.organizations o where o.id=v_link.organization_id;
  select balance into v_balance from public.customer_balances
  where organization_id=v_link.organization_id and id=v_link.customer_id;
  return jsonb_build_object(
    'shop_name', v_shop_name,
    'shop_phone', v_shop_phone,
    'customer_name', v_link.customer_name,
    'balance', coalesce(v_balance,'0'),
    'entries', (
      select coalesce(jsonb_agg(entry order by entry->>'occurred_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('kind','sale','id',s.id,'amount',s.total::text,
          'occurred_at',s.occurred_at,'reversed',s.reversed_at is not null,'paid_immediately',s.paid_immediately,
          'opening',s.is_opening,
          'invoice', exists(
            select 1 from public.documents d
            where d.organization_id=s.organization_id and d.id=s.document_id and d.status='digitized'
          )) as entry
        from public.sales s where s.organization_id=v_link.organization_id and s.customer_id=v_link.customer_id and s.status='posted'
        union all
        select jsonb_build_object('kind','payment','id',id,'amount',amount::text,
          'occurred_at',occurred_at,'reversed',reversed_at is not null,'status',status,
          'opening',is_opening) as entry
        from public.payments where organization_id=v_link.organization_id and customer_id=v_link.customer_id
      ) rows
    )
  );
end
$$;

commit;
