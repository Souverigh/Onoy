import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { dayMonth } from "@/lib/promise";
import { waPhone } from "@/lib/share";
import { Icon } from "@/components/icon";
import { ConfirmButton } from "@/components/confirm-button";
import { RENTAL_COLUMNS, type RentalRow } from "@/lib/rental-data";
import { collateralText, overdueDays, rentalReminder, rentalTotal } from "@/lib/rentals";
import { returnRental } from "./actions";

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
            {rows.map((r) => {
              const out = r.rental_items.filter((i) => !i.returned_at);
              const things = (returned ? r.rental_items : out).sort((a, b) => a.n - b.n).map((i) => i.products?.name ?? "Вещь");
              const lateDays = returned ? 0 : overdueDays(r.due_on, today);
              const total = rentalTotal(r.rental_items.map((i) => Number(i.price_per_day)), r.days);
              const collateral = collateralText(r.collateral_kind, r.collateral_note);
              const phone = !returned && r.customers?.phone ? waPhone(r.customers.phone) : "";
              return (
                <li key={r.id} className={`op-list-item${lateDays ? " rental-late" : ""}`}>
                  <Link className="op-list-main" href={`/rentals/${r.id}`}>
                    <strong>{r.customers?.name ?? "Клиент"}</strong>
                  </Link>
                  <span className={`op-list-amount${lateDays ? " warning" : ""}`}>
                    {returned
                      ? `вернули ${dayMonth(bishkekDate(r.returned_at!))}`
                      : lateDays
                        ? `просрочено ${lateDays} дн.`
                        : r.due_on === today
                          ? "вернуть сегодня"
                          : `до ${dayMonth(r.due_on)}`}
                  </span>
                  <span className="op-list-meta muted">
                    {things.join(", ")}
                    {` · ${money(total.toFixed(2), currency)}`}
                    {r.payment && !r.payment.reversed_at && `, оплатил ${money(r.payment.amount, currency)}`}
                    {collateral && ` · ${collateral}`}
                    {r.deposit && !r.deposit_returned_at && ` · залог ${money(r.deposit, currency)}`}
                  </span>
                  {!returned && (
                    <span className="rental-row-actions">
                      {phone && (
                        <a
                          className="icon-action icon-action-whatsapp"
                          href={`https://wa.me/${phone}?text=${encodeURIComponent(rentalReminder(organizationName, things, dayMonth(r.due_on), lateDays > 0))}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Напомнить ${r.customers?.name ?? ""} в WhatsApp`}
                          title="Напомнить в WhatsApp"
                        >
                          <Icon name="chat" />
                        </a>
                      )}
                      {/* Просрочено — в выдачу: там доплата за лишние дни. В срок — сразу, с подтверждением. */}
                      {lateDays ? (
                        <Link className="button" href={`/rentals/${r.id}#return`}>
                          Вернул →
                        </Link>
                      ) : (
                        <form action={returnRental}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="deposit_back" value="1" />
                          <ConfirmButton
                            className="button"
                            message={`${r.customers?.name ?? "Клиент"} вернул всё?`}
                            text={[
                              things.join(", "),
                              collateral && `Отдайте залог: ${collateral}.`,
                              r.deposit && !r.deposit_returned_at && `Залог ${money(r.deposit, currency)} вернётся из кассы.`,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            confirmLabel="Да, вернул"
                            cancelLabel="Нет"
                          >
                            Вернул
                          </ConfirmButton>
                        </form>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
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
