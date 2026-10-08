import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { money, phoneText } from "@/lib/format";
import { dayMonth } from "@/lib/promise";
import { paymentLabel, type PaymentKind } from "@/lib/entry-labels";
import { CURRENCIES, CURRENCY_SIGN, isCurrency, type Currency } from "@/lib/currency";
import { submitClaim } from "./actions";
import { ClaimPhotoField } from "@/components/claim-photo-field";
import { CopyButton } from "@/components/copy-button";
import { ContactLinks } from "@/components/contact-links";
import { normalizePhone } from "@/lib/contacts";

// Страница клиента — не для поиска (задача 46).
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Entry = {
  kind: "sale" | "payment";
  id: string;
  amount: string;
  occurred_at: string;
  reversed: boolean;
  opening?: boolean;
  status?: string;
  /** Есть сверенная накладная — можно открыть картинку и PDF. */
  invoice?: boolean;
  payment_kind?: PaymentKind;
  note?: string | null;
  reject_comment?: string | null;
};
type Statement = {
  currency?: string;
  shop_name: string;
  shop_phone: string;
  customer_name: string;
  balance: string;
  promised_date?: string | null;
  entries: Entry[];
  /** Оплаты в другой валюте: исходная сумма и курс (миграция 36). */
  originals?: Record<string, { amount: string; currency: string; rate: string }>;
};
type Payment = { mbank?: string; optima?: string; odengi?: string; qr_image?: string | null; address?: string };

/** Сколько последних накладных показываем картинкой, остальные — ссылкой. */
const INVOICE_IMAGES = 3;

const waLink = (phone: string, text: string) =>
  `https://wa.me/${normalizePhone(phone).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

/**
 * Выписка для клиента: страница с проверкой ссылки (миграция 20261005130000)
 * — без отменённых записей и заметок, с причиной отказа. Миграция ещё не
 * применена — та же выписка, отфильтрованная здесь.
 */
async function loadStatement(token: string) {
  const anon = createAnonClient();
  const page = await anon.rpc("get_client_page_by_token", { p_token: token });
  if (!page.error && page.data) return { anon, statement: page.data as Statement, error: null };
  if (page.error && !/get_client_page_by_token|function/i.test(page.error.message))
    return { anon, statement: null, error: page.error.message };
  const fallback = await anon.rpc("get_statement_by_token", { p_token: token });
  if (fallback.error || !fallback.data) return { anon, statement: null, error: fallback.error?.message ?? "invalid_token" };
  const statement = fallback.data as Statement;
  statement.entries = statement.entries.filter((e) => !e.reversed).map(({ note: _note, ...e }) => e);
  return { anon, statement, error: null };
}

function entryLabel(entry: Entry) {
  if (entry.opening) return entry.kind === "sale" ? "Долг из тетради" : "Аванс из тетради";
  if (entry.kind === "sale") return "Покупка";
  if (entry.status === "pending") return "Оплата - ждёт подтверждения магазина";
  if (entry.status === "rejected")
    return `Заявка отклонена${entry.reject_comment ? `: ${entry.reject_comment}` : ""}`;
  return paymentLabel(entry.payment_kind);
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ claimed?: string; error?: string; fromReceipt?: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/i.test(token)) notFound();
  const { anon, statement, error } = await loadStatement(token);

  // Отозванная ссылка (задача 22) — и QR со старых накладных ведёт сюда же.
  if (!statement) {
    if (!error?.includes("invalid_token")) notFound();
    const revoked = await anon.rpc("get_revoked_link_shop", { p_token: token });
    const shop = (revoked.error ? null : revoked.data) as { shop_name: string; shop_phone: string } | null;
    if (!shop) notFound();
    return (
      <main className="client-page">
        <header className="client-header">
          <strong>{shop.shop_name}</strong>
        </header>
        <section className="panel client-revoked">
          <h1>Ссылка больше не действует</h1>
          <p>Напишите магазину - пришлют новую.</p>
          {shop.shop_phone && (
            <a
              className="button primary whatsapp"
              href={waLink(shop.shop_phone, "Здравствуйте! Ссылка на мои накладные и долг больше не открывается - пришлите, пожалуйста, новую.")}
            >
              Написать в WhatsApp
            </a>
          )}
        </section>
      </main>
    );
  }

  const paymentResult = await anon.rpc("get_shop_payment_by_token", { p_token: token });
  const pay = (paymentResult.error ? null : paymentResult.data) as Payment | null;
  const accounts = [
    { label: "MBank", value: pay?.mbank },
    { label: "Optima", value: pay?.optima },
    { label: "О!Деньги", value: pay?.odengi },
  ].filter((a) => a.value);

  const { claimed, error: submitError, fromReceipt } = await searchParams;
  const balance = Number(statement.balance);
  const cur = statement.currency ?? "KGS";
  // Валюта перевода: сначала валюта долга, дальше остальные — клиент мог
  // перевести в сомах при долге в рублях (курс подставит сервер).
  const debtCurrency: Currency = isCurrency(cur) ? cur : "KGS";
  const claimCurrencies = [debtCurrency, ...CURRENCIES.filter((c) => c !== debtCurrency)];
  let imagesLeft = INVOICE_IMAGES;

  return (
    <main className="client-page">
      <header className="client-header">
        <strong>{statement.shop_name}</strong>
        {statement.shop_phone && (
          <a href={waLink(statement.shop_phone, "Здравствуйте, у меня вопрос по долгу")} className="text-button">
            Написать в WhatsApp
          </a>
        )}
      </header>
      <section className="client-balance">
        <p className="muted">{statement.customer_name}, ваш долг</p>
        <p className="client-balance-number">{money(Math.max(balance, 0), cur)}</p>
        {balance < 0 && <p className="muted">У вас аванс: {money(-balance, cur)}</p>}
        {balance > 0 && statement.promised_date && (
          <p className="muted">Срок оплаты - до {dayMonth(statement.promised_date)}</p>
        )}
      </section>
      {claimed && (
        <p className="notice success" role="status">
          Заявка отправлена.{fromReceipt ? " Сумму прочитали с чека." : ""} Магазин подтвердит оплату - долг
          обновится после этого.
        </p>
      )}

      <section className="panel">
        <h2>История</h2>
        {statement.entries.length ? (
          <ul className="client-history client-history-scroll">
            {statement.entries.map((entry) => {
              const original = entry.kind === "payment" ? statement.originals?.[entry.id] : undefined;
              const showImage = Boolean(entry.invoice && !entry.opening && imagesLeft-- > 0);
              const up = entry.kind === "sale";
              return (
                <li key={entry.kind + entry.id} className={`client-entry${entry.status === "rejected" ? " rejected" : ""}`}>
                  <div className="client-entry-head">
                    <span>
                      <strong>{entryLabel(entry)}</strong>
                      <small className="muted">
                        {new Intl.DateTimeFormat("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          timeZone: "Asia/Bishkek",
                        }).format(new Date(entry.occurred_at))}
                      </small>
                    </span>
                    <span className={`client-entry-sum${entry.status === "rejected" ? " muted" : up ? " up" : " down"}`}>
                      {original ? money(original.amount, original.currency) : money(entry.amount, cur)}
                      {original && <small className="muted">≈ {money(entry.amount, cur)}</small>}
                    </span>
                  </div>
                  {showImage && (
                    <a className="client-invoice-image" href={`/c/${token}/invoice/${entry.id}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/c/${token}/invoice/${entry.id}/image`} alt="Накладная" loading="lazy" />
                    </a>
                  )}
                  {entry.invoice && !entry.opening && (
                    <a className="text-button" href={`/c/${token}/invoice/${entry.id}`}>
                      {showImage ? "Открыть PDF" : "Накладная"}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Операций пока нет.</p>
        )}
      </section>

      <section className="panel client-claim-panel" id="pay">
        <h2>Оплатить</h2>
        {balance > 0 && (accounts.length > 0 || pay?.qr_image) && (
          <div className="client-pay">
            {accounts.length > 0 && (
              <ul className="client-accounts">
                {accounts.map((a) => (
                  <li key={a.label}>
                    <span>
                      <small className="muted">{a.label}</small>
                      <strong>{a.value!.replace(/\D/g, "").length >= 9 ? phoneText(a.value) : a.value}</strong>
                    </span>
                    <CopyButton text={a.value!.replace(/\s/g, "")} />
                  </li>
                ))}
              </ul>
            )}
            {pay?.qr_image && (
              <figure className="client-qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pay.qr_image} alt={`QR для оплаты магазину ${statement.shop_name}`} />
                <figcaption className="muted">Отсканируйте в приложении банка</figcaption>
              </figure>
            )}
            <p className="muted">После оплаты укажите сумму или приложите чек и нажмите «Отправить» - магазин подтвердит.</p>
          </div>
        )}
        {submitError && (
          <p className="form-error" role="alert">
            {submitError === "photo"
              ? "Не удалось загрузить фото. Попробуйте без фото или другим файлом."
              : submitError === "amount"
                ? "Введите сумму или приложите чек - тогда сумму прочитаем с него."
                : submitError === "unread"
                  ? "Не смогли прочитать сумму на чеке - введите её вручную."
                  : submitError === "rate"
                    ? "Курс сейчас недоступен - укажите сумму в валюте долга или попробуйте позже."
                    : "Проверьте сумму и попробуйте снова."}
          </p>
        )}
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
              Можно не вводить, если приложите чек, - сумму и валюту прочитаем с него. Оплата сохранится в той
              валюте, в которой вы перевели; ваш долг - в {CURRENCY_SIGN[debtCurrency]}, в него она зачтётся по
              курсу Нацбанка.
            </small>
          </label>
          <label>
            Комментарий (необязательно)
            <input name="comment" maxLength={500} placeholder="Например: перевёл на карту" />
          </label>
          <ClaimPhotoField />
          <button className="button primary" type="submit">
            Отправить
          </button>
        </form>
      </section>
      {/* Кружок справа внизу: без JS, раскрывается через <details>. */}
      <details className="client-promo">
        <summary aria-label="Depter: удобный счёт для ваших клиентов">D</summary>
        <div className="client-promo-card">
          <p>Хотите такой же удобный и понятный счёт для своих клиентов? Напишите нам - поможем.</p>
          <ContactLinks />
        </div>
      </details>
      <footer className="client-footer">
        <a href="https://depter.kg" className="text-button">
          Сделано в Depter
        </a>
      </footer>
    </main>
  );
}
