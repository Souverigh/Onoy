import { notFound } from "next/navigation";
import { DOCUMENT_ACCEPT } from "@/lib/pages";
import { createAnonClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { dayMonth } from "@/lib/promise";
import { paymentLabel, type PaymentKind } from "@/lib/entry-labels";
import { CURRENCIES, CURRENCY_SIGN, isCurrency, type Currency } from "@/lib/currency";
import { submitClaim } from "./actions";

type Statement = {
  currency?: string;
  shop_name: string;
  shop_phone: string;
  customer_name: string;
  balance: string;
  promised_date?: string | null;
  entries: {
    kind: "sale" | "payment";
    id: string;
    amount: string;
    occurred_at: string;
    reversed: boolean;
    opening?: boolean;
    status?: string;
    /** Есть сверенная накладная — можно открыть PDF. */
    invoice?: boolean;
    payment_kind?: PaymentKind;
    note?: string | null;
  }[];
  /** Оплаты в другой валюте: исходная сумма и курс (миграция 36). */
  originals?: Record<string, { amount: string; currency: string; rate: string }>;
};

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ claimed?: string; error?: string; fromReceipt?: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/i.test(token)) notFound();
  const anon = createAnonClient();
  const { data, error } = await anon.rpc("get_statement_by_token", { p_token: token });
  if (error || !data) notFound();
  const statement = data as Statement;
  const { claimed, error: submitError, fromReceipt } = await searchParams;
  const balance = Number(statement.balance);
  const cur = statement.currency ?? "KGS";
  // Валюта перевода: сначала валюта долга, дальше остальные — клиент мог
  // перевести в сомах при долге в рублях (курс подставит сервер).
  const debtCurrency: Currency = isCurrency(cur) ? cur : "KGS";
  const claimCurrencies = [debtCurrency, ...CURRENCIES.filter((c) => c !== debtCurrency)];

  return (
    <main className="client-page">
      <header className="client-header">
        <strong>{statement.shop_name}</strong>
        {statement.shop_phone && (
          <a
            href={`https://wa.me/${statement.shop_phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent("Здравствуйте, у меня вопрос по долгу")}`}
            className="text-button"
          >
            Написать в WhatsApp
          </a>
        )}
      </header>
      <section className="client-balance">
        <p className="muted">{statement.customer_name}, ваш долг</p>
        <p className="client-balance-number">{money(Math.max(balance, 0), cur)}</p>
        {balance < 0 && <p className="muted">У вас аванс: {money(-balance, cur)}</p>}
        {balance > 0 && statement.promised_date && (
          <p className="muted">Срок оплаты — до {dayMonth(statement.promised_date)}</p>
        )}
      </section>
      {claimed && (
        <p className="notice success" role="status">
          Заявка отправлена.{fromReceipt ? " Сумму прочитали с чека." : ""} Магазин подтвердит оплату — долг
          обновится после этого.
        </p>
      )}
      {submitError && (
        <p className="form-error" role="alert">
          {submitError === "photo"
            ? "Не удалось загрузить фото. Попробуйте без фото или другим файлом."
            : submitError === "amount"
              ? "Введите сумму или приложите чек — тогда сумму прочитаем с него."
              : submitError === "unread"
                ? "Не смогли прочитать сумму на чеке — введите её вручную."
            : submitError === "rate"
              ? "Курс сейчас недоступен — укажите сумму в валюте долга или попробуйте позже."
              : "Проверьте сумму и попробуйте снова."}
        </p>
      )}
      <section className="panel client-claim-panel">
        <h2>Я оплатил</h2>
        <form action={submitClaim} className="simple-operation-form">
          <input type="hidden" name="token" value={token} />
          <fieldset className="amount-currency claim-currency">
            <legend>В какой валюте перевели?</legend>
            {claimCurrencies.map((c) => (
              <label key={c} className="party-suggestion">
                <input type="radio" name="currency" value={c} defaultChecked={c === debtCurrency} />
                {CURRENCY_SIGN[c]}
              </label>
            ))}
          </fieldset>
          <label className="amount-field">
            Сколько перевели?
            <input name="amount" inputMode="decimal" pattern="[0-9 ]+([.,][0-9]{1,2})?" placeholder="0" />
            <small className="muted">
              Можно не вводить, если приложите чек, — сумму и валюту прочитаем с него. Оплата сохранится в той
              валюте, в которой вы перевели; ваш долг — в {CURRENCY_SIGN[debtCurrency]}, в него она зачтётся по
              курсу Нацбанка.
            </small>
          </label>
          <label>
            Комментарий (необязательно)
            <input name="comment" maxLength={500} placeholder="Например: перевёл на карту" />
          </label>
          <label className="photo-field">
            Фото, скриншот или PDF квитанции (необязательно)
            <input name="photo" type="file" accept={DOCUMENT_ACCEPT} />
          </label>
          <button className="button primary" type="submit">
            Отправить
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>История</h2>
        {statement.entries.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Операция</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((entry, i) => (
                  <tr key={i} className={entry.reversed ? "reversed-row" : ""}>
                    <td>
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeZone: "Asia/Bishkek",
                      }).format(new Date(entry.occurred_at))}
                    </td>
                    <td>
                      {entry.opening
                        ? entry.kind === "sale"
                          ? "Долг из тетради"
                          : "Аванс из тетради"
                        : entry.kind === "sale"
                          ? "Продажа"
                          : entry.status === "pending"
                            ? "Заявка (ждёт)"
                            : paymentLabel(entry.payment_kind)}
                      {entry.note && <small className="muted"> — {entry.note}</small>}
                      {entry.reversed && <span className="tag reversed-tag">отменена</span>}
                      {entry.invoice && !entry.reversed && !entry.opening && (
                        <>
                          {" "}
                          <a className="text-button" href={`/c/${token}/invoice/${entry.id}`}>
                            Накладная PDF
                          </a>
                        </>
                      )}
                    </td>
                    <td>
                      {/* Оплата в другой валюте — клиенту в ней, пересчёт в валюту долга подсказкой. */}
                      {entry.kind === "payment" && statement.originals?.[entry.id] ? (
                        <>
                          {money(statement.originals[entry.id].amount, statement.originals[entry.id].currency)}
                          <small className="muted history-original">≈ {money(entry.amount, cur)}</small>
                        </>
                      ) : (
                        money(entry.amount, cur)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Операций пока нет.</p>
        )}
      </section>
      <footer className="client-footer">
        <a href="https://depter.kg" className="text-button">
          Открыть свой Depter
        </a>
      </footer>
    </main>
  );
}
