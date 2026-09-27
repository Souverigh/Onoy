-- Обещанная дата оплаты и просрочка 30 / 60 / 90 (ТЗ §3, §9). Решение
-- пользователя: просрочка считается от даты неоплаченной продажи — оплаты
-- гасят самые старые продажи (FIFO), остаток каждой продажи стареет со дня
-- продажи. Обещанная дата — отдельно. Новые колонка и вид; существующие
-- данные не меняются (у всех клиентов promised_date = null).
begin;

alter table public.customers add column promised_date date;
grant update (promised_date) on public.customers to authenticated;

-- customer_balances раскрывает c.* при создании — пересоздаём, чтобы в нём
-- появился promised_date. Тело — как в debt_ledger.sql.
drop view public.customer_balances;
create view public.customer_balances
with (security_invoker=true) as
 select c.*,
   (
     coalesce((
       select sum(s.total) from public.sales s
       where s.organization_id=c.organization_id and s.customer_id=c.id
         and s.status='posted' and not s.paid_immediately and s.reversed_at is null
     ),0)::numeric(16,2)
     - coalesce((
       select sum(p.amount) from public.payments p
       where p.organization_id=c.organization_id and p.customer_id=c.id
         and p.status='confirmed' and p.reversed_at is null
     ),0)::numeric(16,2)
   )::text as balance
 from public.customers c;
revoke all on public.customer_balances from anon, authenticated;
grant select on public.customer_balances to authenticated;

-- Неоплаченный остаток долга по давности (дни — по Бишкеку). Строка есть
-- только у клиента с долгом; сумма корзин = balance. security_invoker —
-- видны только свои магазины (RLS sales/payments).
create view public.customer_debt_aging
with (security_invoker=true) as
with credit as (
  select s.organization_id, s.customer_id, s.occurred_at, s.total,
    sum(s.total) over (
      partition by s.organization_id, s.customer_id order by s.occurred_at, s.id
    ) as running
  from public.sales s
  where s.status='posted' and not s.paid_immediately and s.reversed_at is null
), paid as (
  select organization_id, customer_id, sum(amount) as amount
  from public.payments
  where status='confirmed' and reversed_at is null and customer_id is not null
  group by organization_id, customer_id
), aged as (
  select c.organization_id, c.customer_id,
    greatest(0, least(c.total, c.running - coalesce(p.amount,0))) as unpaid,
    (now() at time zone 'Asia/Bishkek')::date - (c.occurred_at at time zone 'Asia/Bishkek')::date as age
  from credit c
  left join paid p on p.organization_id=c.organization_id and p.customer_id=c.customer_id
)
select organization_id, customer_id,
  coalesce(sum(unpaid) filter (where age <= 30), 0)::numeric(16,2)::text as due_0_30,
  coalesce(sum(unpaid) filter (where age between 31 and 60), 0)::numeric(16,2)::text as due_31_60,
  coalesce(sum(unpaid) filter (where age between 61 and 90), 0)::numeric(16,2)::text as due_61_90,
  coalesce(sum(unpaid) filter (where age > 90), 0)::numeric(16,2)::text as due_over_90,
  max(age) as oldest_days
from aged
where unpaid > 0
group by organization_id, customer_id;
revoke all on public.customer_debt_aging from anon, authenticated;
grant select on public.customer_debt_aging to authenticated;

-- Страница клиента: + обещанная дата (ТЗ: «крупно долг и обещанная дата»).
-- Тело — как в invoice_by_token.sql.
create or replace function public.get_statement_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_link record; v_shop_name text; v_shop_phone text; v_balance text;
begin
  if p_token is null or length(p_token) <> 32 then raise exception 'invalid_token'; end if;
  select l.*, c.name as customer_name, c.phone as customer_phone, c.promised_date
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
    'promised_date', v_link.promised_date,
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
