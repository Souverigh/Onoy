-- Имя и телефон продавца для накладной — у каждого сотрудника свои: он
-- задаёт их сам в Настройках. Не задал — на накладной данные из Настроек
-- магазина (владельца). Только новая колонка с default и функции —
-- существующие данные не меняются. Применять после 20261012110000.
begin;

alter table public.organization_members
  add column invoice_name text not null default '' check (length(invoice_name) <= 80);

-- Сотрудник меняет только свою строку в своём магазине; пишем в журнал.
create function public.set_my_invoice_details(p_org uuid, p_name text, p_phone text) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
begin
  if not private.is_member(p_org) then raise exception 'not_member'; end if;
  if length(v_name) > 80 or length(v_phone) > 40 then raise exception 'invalid_details'; end if;
  update public.organization_members set invoice_name=v_name, invoice_phone=v_phone
  where organization_id=p_org and user_id=auth.uid();
  if not found then raise exception 'invalid_member'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org,auth.uid(),'member.invoice_details_changed',auth.uid(),jsonb_build_object('name',v_name,'phone',v_phone));
end
$$;
revoke all on function public.set_my_invoice_details(uuid,text,text) from public, anon;
grant execute on function public.set_my_invoice_details(uuid,text,text) to authenticated;

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
      -- пусто — имя из Настроек магазина (shop_seller_name).
      'staff_seller_name', case when m.role='staff' then nullif(trim(m.invoice_name), '') end,
      'staff_seller_phone', case when m.role='staff' then nullif(m.invoice_phone, '') end,
      'seller_name', coalesce(m.display_name, (
        select o.display_name from public.organization_members o
        where o.organization_id=s.organization_id and o.role='owner' and o.display_name is not null
        order by o.created_at limit 1
      ))
    )
    from public.sales s
    join public.customers c on c.organization_id=s.organization_id and c.id=s.customer_id
    join public.organizations o on o.id=s.organization_id
    left join public.organization_members m on m.organization_id=s.organization_id and m.user_id=s.created_by
    where s.organization_id=p_org and s.id=p_sale
  ), '{}'::jsonb)
$$;
revoke all on function private.sale_invoice_info(uuid,uuid) from public, anon, authenticated;

commit;
