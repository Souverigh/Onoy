-- Лимит долга клиента (ТЗ §4 Б): если долг после продажи превысит лимит —
-- красное предупреждение в форме до подтверждения. Только предупреждение,
-- продажу не блокирует. Пусто (null) — лимита нет. Существующие клиенты
-- получают null, данные не меняются.
begin;

alter table public.customers add column credit_limit numeric(16,2)
  check (credit_limit is null or (credit_limit >= 0 and credit_limit < 1e14));
grant update (credit_limit) on public.customers to authenticated;

-- Вид раскрывает c.* при создании — пересоздаём, чтобы в нём появился
-- credit_limit. Тело — как в debt_ledger.sql.
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

commit;
