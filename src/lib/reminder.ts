import { money } from "./format";
import { dayMonth, promiseStatus } from "./promise";

/**
 * Текст напоминания клиенту в WhatsApp (карточка клиента и «Кому напомнить
 * сегодня» на главной). Аванс — словами, без минуса.
 */
export function reminderMessage(input: {
  shopName: string;
  balance: number;
  currency: string;
  promisedDate?: string | null;
  today: string;
  /** Страница клиента, если ссылка есть. */
  link?: string | null;
}): string {
  const promise = promiseStatus(input.promisedDate, input.balance, input.today);
  const promiseLine =
    promise.kind === "broken"
      ? ` Вы обещали оплатить до ${dayMonth(promise.date)}.`
      : promise.kind === "upcoming"
        ? ` Срок оплаты - ${dayMonth(promise.date)}.`
        : "";
  const debt =
    input.balance > 0
      ? `ваш долг ${money(input.balance, input.currency)}.${promiseLine}`
      : input.balance < 0
        ? `долга нет, ваш аванс ${money(-input.balance, input.currency)}.`
        : "долга нет.";
  return `Магазин «${input.shopName}»: ${debt}${input.link ? ` Накладные и история: ${input.link}` : ""}`;
}
