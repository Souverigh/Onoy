import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { Icon } from "@/components/icon";
import { RentalRowItem } from "@/components/rental-row";
import { RENTAL_COLUMNS, type RentalRow } from "@/lib/rental-data";
import { overdueDays } from "@/lib/rentals";

/**
 * Прокат (модуль rental): «На руках» — сверху просроченные, потом по дню
 * возврата; «Вернули» — последние 50. В строке — «Вернул» и напоминание в
 * WhatsApp, без захода в выдачу; просроченную — через выдачу (доплата).
 */
export default async function RentalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const { db, organizationId, organizationName, currency, modules } = await getContext();
  if (!modules.includes("rental")) notFound();
  const returned = tab === "returned";
  let request = db.from("rentals").select(RENTAL_COLUMNS).eq("organization_id", organizationId).is("reversed_at", null);
  request = returned
    ? request.not("returned_at", "is", null).order("returned_at", { ascending: false }).limit(50)
    : request.is("returned_at", null).order("due_on").order("issued_at").limit(300);
  const { data, error } = await request;
  if (error) console.error("RentalsPage failed", { message: error.message });
  const rows = (data ?? []) as unknown as RentalRow[];
  const today = bishkekDate();
  const late = rows.filter((r) => !returned && overdueDays(r.due_on, today) > 0).length;
  const dueToday = rows.filter((r) => !returned && r.due_on === today).length;
  const deposits = returned ? 0 : rows.reduce((s, r) => s + (r.deposit && !r.deposit_returned_at ? Number(r.deposit) : 0), 0);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Прокат</h1>
          <p className="muted">Что сейчас у клиентов, до какого дня и под какой залог.</p>
        </div>
        <div className="heading-actions directory-heading-actions">
          <Link className="button primary" href="/rentals/new">
            <Icon name="plus" />
            Выдать
          </Link>
        </div>
      </div>
      <nav className="tabs">
        <Link className={returned ? "" : "selected"} href="/rentals">
          На руках{!returned && rows.length ? ` · ${rows.length}` : ""}
        </Link>
        <Link className={returned ? "selected" : ""} href="/rentals?tab=returned">
          Вернули
        </Link>
      </nav>
      {!returned && (late > 0 || dueToday > 0 || deposits > 0) && (
        <p className="rental-summary">
          {[
            late > 0 && <span key="late" className="warning">Просрочено: {late}</span>,
            dueToday > 0 && <span key="today">Вернуть сегодня: {dueToday}</span>,
            deposits > 0 && <span key="dep" className="muted">Залогов деньгами: {money(deposits.toFixed(2), currency)}</span>,
          ].filter(Boolean)}
        </p>
      )}
      <section className="panel">
        {rows.length ? (
          <ul className="rental-list">
            {rows.map((r) => (
              <RentalRowItem key={r.id} r={r} today={today} currency={currency} shopName={organizationName} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            {returned ? "Вернувших пока нет." : "Сейчас ничего не выдано. Нажмите «Выдать», чтобы записать прокат."}
          </p>
        )}
      </section>
      {/* Телефон: «Выдать» внизу, над нижней панелью — под большим пальцем. */}
      <div className="bottom-actions-spacer" aria-hidden="true" />
      <div className="directory-bottom-actions">
        <Link className="button primary" href="/rentals/new">
          <Icon name="plus" />
          Выдать
        </Link>
      </div>
    </>
  );
}
