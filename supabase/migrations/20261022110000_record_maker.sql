-- Кто продал (просьба пользователя 22.10.2026). Владелец нажимает «Исправить»
-- у продажи сотрудника: старая отменяется, новую записывает владелец — и она
-- уходила от продавца к владельцу (статистика «Продавцы», накладная, история).
-- Теперь у продажи и прихода отдельно:
--   created_by     — кто записал (как раньше; права «отменить свою» — по нему);
--   made_by        — кто продал / принял, если это не тот, кто записал;
--   corrected_from — какую отменённую запись исправляет (или открыта заново);
--   maker_id       — чья запись: made_by, иначе created_by (вычисляется базой).
-- Новые колонки пустые, maker_id для старых записей = created_by: существующие
-- данные не меняются. Ставит made_by только функция set_record_maker — сразу
-- после записи исправления, из отменённой записи.
begin;

alter table public.sales add column made_by uuid references auth.users(id);
alter table public.sales add column corrected_from uuid;
alter table public.sales add constraint sales_corrected_from_fkey
  foreign key (organization_id, corrected_from) references public.sales(organization_id, id);
alter table public.sales add column maker_id uuid generated always as (coalesce(made_by, created_by)) stored;
create index sales_org_maker_idx on public.sales(organization_id, maker_id);

alter table public.purchases add column made_by uuid references auth.users(id);
alter table public.purchases add column corrected_from uuid;
alter table public.purchases add constraint purchases_corrected_from_fkey
  foreign key (organization_id, corrected_from) references public.purchases(organization_id, id);
alter table public.purchases add column maker_id uuid generated always as (coalesce(made_by, created_by)) stored;

-- Новая запись взамен отменённой p_from: продавец — как у отменённой, или
-- p_made_by (другого сотрудника выбирает только владелец). Только свежая
-- живая запись, ещё ни к чему не привязанная; автор записи или владелец.
create function public.set_record_maker(p_org uuid, p_kind text, p_id uuid, p_from uuid, p_made_by uuid default null)
returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_owner boolean;
  v_old uuid;
  v_maker uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not private.is_member(p_org) then raise exception 'access_denied'; end if;
  if p_kind not in ('sale','purchase') or p_id is null or p_from is null or p_id = p_from then
    raise exception 'invalid_maker';
  end if;
  v_owner := private.is_owner(p_org);
  if p_kind = 'sale' then
    select maker_id into v_old from public.sales
    where organization_id = p_org and id = p_from and reversed_at is not null;
  else
    select maker_id into v_old from public.purchases
    where organization_id = p_org and id = p_from and reversed_at is not null;
  end if;
  if not found then raise exception 'invalid_maker'; end if;
  v_maker := coalesce(p_made_by, v_old);
  if p_made_by is not null and p_made_by is distinct from v_old then
    if p_made_by <> auth.uid() and not v_owner then raise exception 'owner_only'; end if;
    if not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_made_by) then
      raise exception 'invalid_maker';
    end if;
  end if;
  if p_kind = 'sale' then
    update public.sales set made_by = v_maker, corrected_from = p_from
    where organization_id = p_org and id = p_id and status = 'posted' and reversed_at is null
      and corrected_from is null and (created_by = auth.uid() or v_owner);
  else
    update public.purchases set made_by = v_maker, corrected_from = p_from
    where organization_id = p_org and id = p_id and status = 'posted' and reversed_at is null
      and corrected_from is null and (created_by = auth.uid() or v_owner);
  end if;
  if not found then raise exception 'invalid_maker'; end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_id,metadata)
  values(p_org, auth.uid(), p_kind || '.maker_set', p_id, jsonb_build_object('from', p_from, 'made_by', v_maker));
  return v_maker;
end
$$;

revoke all on function public.set_record_maker(uuid,text,uuid,uuid,uuid) from public, anon;
grant execute on function public.set_record_maker(uuid,text,uuid,uuid,uuid) to authenticated;

-- Накладная: имя продавца — того, кто продал (maker_id), а не кто записал.
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
    left join public.organization_members m on m.organization_id=s.organization_id and m.user_id=s.maker_id
    where s.organization_id=p_org and s.id=p_sale
  ), '{}'::jsonb)
$$;
revoke all on function private.sale_invoice_info(uuid,uuid) from public, anon, authenticated;

create or replace function public.app_schema_version() returns text
language sql immutable set search_path='' as $$ select '20261022110000' $$;
revoke all on function public.app_schema_version() from public;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
