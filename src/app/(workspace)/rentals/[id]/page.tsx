import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money, phoneText } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { dayMonth } from "@/lib/promise";
import { waPhone } from "@/lib/share";
import { memberLabels } from "@/lib/members";
import { Submit } from "@/components/submit";
import { RentalReturn } from "@/components/rental-return";
import { Icon } from "@/components/icon";
import { RENTAL_COLUMNS, type RentalRow } from "@/lib/rental-data";
import { collateralText, daysWord, extraCharge, overdueDays, rentalReminder, rentalTotal } from "@/lib/rentals";
import { returnDeposit, returnRental, reverseRental } from "../actions";

const ERRORS: Record<string, string> = {
  amount: "Доплата - только цифры, например 1 400.",
  reason: "Напишите, почему отменяете выдачу.",
  owner: "Отменить выдачу может только владелец.",
  save: "Не получилось сохранить. Обновите страницу и попробуйте ещё раз.",
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );

/** Выдача: что взяли, до какого дня, залог; «Вернул» — всё или по вещи. */
export default async function RentalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; issued?: string; returned?: string; deposit?: string; reversed?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, organizationId, organizationName, currency, isOwner, modules } = await getContext();
  if (!modules.includes("rental")) notFound();
  const { data } = await db.from("rentals").select(RENTAL_COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  const r = data as unknown as RentalRow | null;
  if (!r) notFound();
  const saleIds = [r.sale_id, r.extra_sale_id].filter((s): s is string => Boolean(s));
  const [sales, members] = await Promise.all([
    saleIds.length
      ? db.from("sales").select("id,total,paid_immediately").eq("organization_id", organizationId).in("id", saleIds)
      : Promise.resolve({ data: [] as { id: string; total: string; paid_immediately: boolean }[] }),
    memberLabels(db, organizationId),
  ]);
  const saleOf = (sid: string | null) => (sales.data ?? []).find((s) => s.id === sid);
  const sale = saleOf(r.sale_id);
  const extra = saleOf(r.extra_sale_id);

  const today = bishkekDate();
  const items = [...r.rental_items].sort((a, b) => a.n - b.n);
  const out = items.filter((i) => !i.returned_at);
  const open = !r.returned_at && !r.reversed_at;
  const lateDays = open ? overdueDays(r.due_on, today) : 0;
  const suggested = extraCharge(out.map((i) => Number(i.price_per_day)), lateDays);
  const deposit = r.deposit ? money(r.deposit, currency) : null;
  const collateral = collateralText(r.collateral_kind, r.collateral_note);
  const phone = r.customers?.phone ? waPhone(r.customers.phone) : "";
  const remind =
    open && phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(
          rentalReminder(organizationName, out.map((i) => i.products?.name ?? "вещь"), dayMonth(r.due_on), lateDays > 0),
        )}`
      : null;

  return (
    <>
      <Link className="back-link" href="/rentals">
        ← Прокат
      </Link>
      <div className="page-heading">
        <div>
          <h1>
            <Link href={`/customers/${r.customer_id}`}>{r.customers?.name ?? "Клиент"}</Link>
          </h1>
          <p className="muted">
            {r.reversed_at ? (
              <span className="tag reversed-tag">отменена</span>
            ) : r.returned_at ? (
              <span className="tag green">вернули {dayMonth(bishkekDate(r.returned_at))}</span>
            ) : lateDays ? (
              <span className="tag reversed-tag">просрочено {lateDays} дн.</span>
            ) : (
              <span className="tag">на руках до {dayMonth(r.due_on)}</span>
            )}
            {r.customers?.phone && <> · {phoneText(r.customers.phone)}</>}
          </p>
        </div>
        {remind && (
          <a
            className="icon-action icon-action-whatsapp"
            href={remind}
            target="_blank"
            rel="noreferrer"
            aria-label="Напомнить в WhatsApp"
            title="Напомнить в WhatsApp"
          >
            <Icon name="chat" />
          </a>
        )}
      </div>

      {q.error && (
        <p className="form-error" role="alert">
          {ERRORS[q.error] ?? ERRORS.save}
        </p>
      )}
      {q.issued && !r.reversed_at && (
        <p className="notice success" role="status">
          Выдано. Вернуть до {dayMonth(r.due_on)}.
        </p>
      )}
      {q.returned === "part" && open && (
        <p className="notice success" role="status">
          Отмечено. Ещё на руках: {out.length} шт.
        </p>
      )}
      {r.returned_at && !r.reversed_at && (q.returned || q.deposit) && (
        <p className="notice success" role="status">
          Всё вернули.{" "}
          {collateral && `Отдайте залог: ${collateral}.`}
          {deposit && (r.deposit_returned_at ? ` Залог ${deposit} вернули из кассы.` : ` Залог ${deposit} ещё в кассе.`)}
        </p>
      )}
      {r.reversed_at && (
        <p className="notice" role="status">
          Выдача отменена{r.reversal_comment ? `: ${r.reversal_comment}` : ""}. Деньги и залог по ней тоже отменены.
        </p>
      )}

      <section className="panel">
        <dl className="details">
          <dt>Выдали</dt>
          <dd>
            {dateTime(r.issued_at)}
            {r.created_by && members.get(r.created_by) ? ` · ${members.get(r.created_by)!.name}` : ""}
          </dd>
          <dt>Срок</dt>
          <dd>
            {daysWord(r.days)}, до {dayMonth(r.due_on)}
          </dd>
          <dt>Сумма</dt>
          <dd>
            {sale ? (
              <Link href={`/money/send/${sale.id}`}>{money(sale.total, currency)}</Link>
            ) : (
              money(rentalTotal(items.map((i) => Number(i.price_per_day)), r.days).toFixed(2), currency)
            )}
            {sale ? (sale.paid_immediately ? " · оплатил сразу" : " · в долг") : " · бесплатно"}
          </dd>
          {extra && (
            <>
              <dt>Доплата</dt>
              <dd>
                <Link href={`/money/send/${extra.id}`}>{money(extra.total, currency)}</Link>
                {extra.paid_immediately ? " · оплатил сразу" : " · в долг"}
              </dd>
            </>
          )}
          <dt>Залог</dt>
          <dd>{collateral ?? "без документа"}</dd>
          {deposit && (
            <>
              <dt>Залог деньгами</dt>
              <dd>
                {deposit} · {r.deposit_returned_at ? `вернули ${dayMonth(bishkekDate(r.deposit_returned_at))}` : "в кассе"}
              </dd>
            </>
          )}
          {r.note && (
            <>
              <dt>Комментарий</dt>
              <dd>{r.note}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Вещи</h2>
          <span className="muted">{items.length}</span>
        </div>
        <ul className="rental-items">
          {items.map((i) => (
            <li key={i.id}>
              <span>
                <strong>{i.products?.name ?? "Вещь"}</strong>
                <small className="muted">
                  {" "}
                  · {money(i.price_per_day, currency)} / сутки
                  {i.returned_at ? ` · вернули ${dayMonth(bishkekDate(i.returned_at))}` : ""}
                </small>
              </span>
              {/* Несколько человек возвращают в разные дни — по одной вещи; последнюю — формой ниже. */}
              {open && !i.returned_at && out.length > 1 && (
                <form action={returnRental}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="item" value={i.id} />
                  <button className="text-button" type="submit">
                    Вернул только это
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {open && (
        <RentalReturn
          id={r.id}
          count={out.length}
          lateDays={lateDays}
          suggested={suggested}
          deposit={r.deposit_returned_at ? null : deposit}
          collateral={collateral}
          currency={currency}
        />
      )}

      {r.returned_at && !r.reversed_at && r.deposit && !r.deposit_returned_at && (
        <form action={returnDeposit} className="panel">
          <input type="hidden" name="id" value={r.id} />
          <p>Залог {deposit} ещё в кассе.</p>
          <Submit>Отдать залог {deposit}</Submit>
        </form>
      )}

      {isOwner && !r.reversed_at && (
        <details className="panel party-fold">
          <summary>
            <span>
              <strong>Отменить выдачу</strong>
              <small className="muted">Если записали по ошибке: деньги и залог по ней тоже отменятся</small>
            </span>
          </summary>
          <form action={reverseRental} className="simple-operation-form">
            <input type="hidden" name="id" value={r.id} />
            <label>
              Почему отменяем
              <textarea name="comment" maxLength={500} rows={2} required placeholder="Например: не тот клиент" />
            </label>
            <button className="button danger-outline" type="submit">
              Отменить выдачу
            </button>
          </form>
        </details>
      )}
    </>
  );
}
