import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getContext } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { EXPENSE_MAX_AGE_DAYS } from "@/lib/expenses";
import { ExpenseForm } from "@/components/expense-form";

// Расход магазина (аренда, доставка, зарплата…) — вносит любой участник.
export default async function ExpensePage({ searchParams }: { searchParams: Promise<{ undone?: string }> }) {
  const { undone } = await searchParams;
  const { currency, isOwner } = await getContext();
  const today = bishkekDate();
  const minDate = new Date(Date.parse(`${today}T00:00:00Z`) - EXPENSE_MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
  return (
    <>
      <Link className="back-link" href="/">
        ← Назад
      </Link>
      <div className="page-heading operation-page-heading">
        <div>
          <h1>Расход</h1>
        </div>
        {isOwner && (
          <Link className="button" href="/money/expenses">
            Все расходы
          </Link>
        )}
      </div>
      {undone && (
        <p className="notice success" role="status">
          Прошлый расход отменён - введите заново.
        </p>
      )}
      <section className="panel form-panel">
        <ExpenseForm idempotencyKey={randomUUID()} today={today} minDate={minDate} currency={currency} />
      </section>
    </>
  );
}
