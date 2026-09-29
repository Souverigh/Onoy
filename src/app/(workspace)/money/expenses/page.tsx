import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { EXPENSE_CATEGORIES, expenseCategoryLabel, expensesByCategory, isExpenseCategory } from "@/lib/expenses";

type Row = {
  id: string;
  spent_on: string;
  amount: string;
  currency: string;
  category: string;
  note: string | null;
  photos: unknown[];
  reversed_at: string | null;
};

const monthShift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// Все расходы за месяц — владельцу: итог, по категориям, список.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string }>;
}) {
  const { month: rawMonth, category: rawCategory } = await searchParams;
  const { db, organizationId, currency: shopCurrency } = await requireOwner();
  const thisMonth = bishkekDate().slice(0, 7);
  const month = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) && rawMonth <= thisMonth ? rawMonth : thisMonth;
  const category = isExpenseCategory(rawCategory) ? rawCategory : null;
  const { data, error } = await db
    .from("expenses")
    .select("id,spent_on,amount,currency,category,note,photos,reversed_at")
    .eq("organization_id", organizationId)
    .gte("spent_on", `${month}-01`)
    .lt("spent_on", `${monthShift(month, 1)}-01`)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .range(0, 999);
  if (error) throw new Error("Не удалось загрузить расходы");
  const rows = (data ?? []) as Row[];
  const active = rows.filter((r) => !r.reversed_at && r.currency === shopCurrency);
  const byCategory = expensesByCategory(active);
  const total = Math.round(byCategory.reduce((s, c) => s + c.amount * 100, 0)) / 100;
  const shown = category ? rows.filter((r) => r.category === category) : rows;
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${month}-15T12:00:00+06:00`),
  );
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", weekday: "short" }).format(
      new Date(`${d}T12:00:00+06:00`),
    );
  const href = (m: string, c: string | null = category) =>
    `/money/expenses?month=${m}${c ? `&category=${c}` : ""}`;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Расходы</h1>
          <p className="muted">{monthLabel}</p>
        </div>
        <div className="day-nav">
          <Link className="button" href={href(monthShift(month, -1))}>
            ← Раньше
          </Link>
          {month < thisMonth && (
            <Link className="button" href={href(monthShift(month, 1))}>
              Позже →
            </Link>
          )}
          <Link className="button primary" href="/money/expense">
            + Расход
          </Link>
        </div>
      </div>

      <div className="day-grid">
        <section className="panel">
          <h2>Всего за месяц</h2>
          <p className="day-number">{money(total, shopCurrency)}</p>
          <p className="muted">Отменённые расходы не считаются.</p>
        </section>
        <section className="panel">
          <h2>По категориям</h2>
          {byCategory.length === 0 ? (
            <p className="muted">Расходов не было.</p>
          ) : (
            <div className="balance-list">
              {byCategory.map((c) => (
                <Link
                  key={c.category}
                  className="balance-row"
                  href={href(month, category === c.category ? null : c.category)}
                >
                  <span>
                    {expenseCategoryLabel(c.category)}
                    {category === c.category && <span className="tag">выбрано</span>}
                  </span>
                  <strong>{money(c.amount, shopCurrency)}</strong>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-title">
          <h2>{category ? EXPENSE_CATEGORIES[category] : "Все записи"}</h2>
          {category && (
            <Link className="text-button" href={href(month, null)}>
              Показать все
            </Link>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="muted">Записей нет.</p>
        ) : (
          <ul className="recent-list">
            {shown.map((r) => (
              <li key={r.id} className={r.reversed_at ? "reversed-row" : ""}>
                <span>
                  <Link href={`/money/expense/${r.id}`}>
                    <strong>{expenseCategoryLabel(r.category)}</strong>
                  </Link>
                  {r.reversed_at && <span className="tag reversed-tag">отменён</span>}
                  <small className="muted">
                    {dayLabel(r.spent_on)}
                    {r.note ? ` · ${r.note}` : ""}
                    {r.photos?.length ? " · фото" : ""}
                  </small>
                </span>
                <strong className="nowrap">{money(r.amount, r.currency)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
