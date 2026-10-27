import Link from "next/link";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { dayMonth } from "@/lib/promise";
import { waPhone } from "@/lib/share";
import { collateralText, overdueDays, rentalReminder, rentalTotal } from "@/lib/rentals";
import type { RentalRow } from "@/lib/rental-data";
import { returnRental } from "@/app/(workspace)/rentals/actions";
import { Icon } from "./icon";
import { ConfirmButton } from "./confirm-button";

/**
 * Выдача строкой (`ul.rental-list`): кто или что, до какого дня, вещи, сумма
 * и залог; на руках — WhatsApp и «Вернул». Просроченную «Вернул» ведёт в
 * выдачу (там доплата), в срок — сразу, с подтверждением. В списке «Прокат»
 * заголовок строки — клиент, в карточке клиента (`byThings`) — вещи.
 */
export function RentalRowItem({
  r,
  today,
  currency,
  shopName,
  byThings = false,
}: {
  r: RentalRow;
  today: string;
  currency: string;
  shopName: string;
  byThings?: boolean;
}) {
  const returned = Boolean(r.returned_at);
  const out = r.rental_items.filter((i) => !i.returned_at);
  const things = (returned ? r.rental_items : out).sort((a, b) => a.n - b.n).map((i) => i.products?.name ?? "Вещь");
  const lateDays = returned ? 0 : overdueDays(r.due_on, today);
  const total = rentalTotal(r.rental_items.map((i) => Number(i.price_per_day)), r.days);
  const collateral = collateralText(r.collateral_kind, r.collateral_note);
  const phone = !returned && r.customers?.phone ? waPhone(r.customers.phone) : "";
  const name = r.customers?.name ?? "Клиент";
  return (
    <li className={`op-list-item${lateDays ? " rental-late" : ""}`}>
      <Link className="op-list-main" href={`/rentals/${r.id}`}>
        <strong>{byThings ? things.join(", ") : name}</strong>
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
        {!byThings && `${things.join(", ")} · `}
        {money(total.toFixed(2), currency)}
        {collateral && ` · ${collateral}`}
        {r.deposit && !r.deposit_returned_at && ` · залог ${money(r.deposit, currency)}`}
      </span>
      {!returned && (
        <span className="rental-row-actions">
          {phone && (
            <a
              className="icon-action icon-action-whatsapp"
              href={`https://wa.me/${phone}?text=${encodeURIComponent(rentalReminder(shopName, things, dayMonth(r.due_on), lateDays > 0))}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Напомнить ${name} в WhatsApp`}
              title="Напомнить в WhatsApp"
            >
              <Icon name="chat" />
            </a>
          )}
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
                message={`${name} вернул всё?`}
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
}
