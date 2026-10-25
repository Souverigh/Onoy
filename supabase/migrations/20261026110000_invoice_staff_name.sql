-- Накладная продажи сотрудника (просьба пользователя 26.10.2026): Асад
-- оформил продажу, а на накладной «Продавец: Маликнур» — у Асада не задано
-- имя для накладной в его Настройках, и бралось имя из Настроек → Магазин.
-- Теперь у продажи сотрудника: его имя для накладной, иначе его имя в
-- команде; телефон — его, иначе общий телефон магазина. Продажи владельца —
-- как раньше. Только функция — данные не меняются.
begin;

create or replace function private.sale_invoice_info(p_org uuid, p_sale uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object(
      'number', (
        select count(*) from public.sales x
        where x.organization_id=s.organization_id and not x.is_opening
          and (x.created_at, x.id) <= (s.created_at, s.id)
      ),
      'paper_number', (
        select left(nullif(trim(e.payload->'extracted'->>'number'), ''), 30)
        from public.document_extractions e
        where s.document_id is not null and e.organization_id=s.organization_id
          and e.document_id=s.document_id and e.payload->>'kind'='invoice'
        order by e.created_at desc limit 1
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
      'shop_seller_name', nullif(o.seller_name, ''),
      'shop_seller_phone', nullif(o.seller_phone, ''),
      'show_debt', o.invoice_show_debt,
      'show_qr', o.invoice_show_qr,
      -- Продажу оформил сотрудник — его имя для накладной из его Настроек;
      -- пусто — его имя в команде (задаёт владелец), не «Продавец» магазина.
      'staff_seller_name', case when m.role='staff'
        then coalesce(nullif(trim(m.invoice_name), ''), nullif(trim(m.display_name), '')) end,
      -- Телефон: его из Настроек; пусто — общий телефон магазина, не владельца.
      'staff_seller_phone', case when m.role='staff'
        then coalesce(nullif(trim(m.invoice_phone), ''), nullif(trim(o.phone), '')) end,
      'seller_name', coalesce(m.display_name, (
        select o.display_name from public.organization_members o
        where o.organization_id=s.organization_id and o.role='owner' and o.display_name is not null
        order by o.created_at limit 1
      ))
    )
    from public.sales s
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    join public.organizations o on o.id=s.organization_id
    left join public.organization_members m on m.organization_id=s.organization_id and m.user_id=s.maker_id
    where s.organization_id=p_org and s.id=p_sale
  ), '{}'::jsonb)
$$;
revoke all on function private.sale_invoice_info(uuid,uuid) from public, anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261026110000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
