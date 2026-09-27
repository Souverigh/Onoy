"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  commitOperation,
  findSimilarRecords,
  prepareReceiptPayment,
  recognizeInvoicePhoto,
  type SimilarRecord,
} from "@/app/(workspace)/money/actions";
import { Submit } from "./submit";
import { money } from "@/lib/format";
import { amountFromInput, creditLimitExceeded } from "@/lib/credit-limit";
import { MULTI_PAGE_MAX_SIDE, shrinkImage, shrinkInputFile } from "@/lib/shrink-image";
import { DOCUMENT_ACCEPT, MAX_PAGES, MAX_UPLOAD_BYTES, isPdf } from "@/lib/pages";

type Operation = "purchase" | "sale" | "payment";
type Party = { id: string; name: string };
/** Клиент с долгом и лимитом — для предупреждения в форме продажи. */
type Customer = Party & { balance?: string; credit_limit?: string | null };
type Suggestion = Party & { balance: string };
type Prefill = {
  documentId: string;
  amount?: string;
  bankRef?: string;
  /** Дата перевода из чека, datetime-local по Бишкеку. */
  date?: string;
  suggestions: Suggestion[];
};
type InvoiceLine = { n: number; name_raw: string; qty: string; unit: string; price: string };
type InvoiceCheckResult = {
  total_computed: number;
  total_declared: number | null;
  counterparty: { name_raw: string } | null;
  lines: InvoiceLine[];
};
type CheckedPhoto = {
  documentId: string;
  result: InvoiceCheckResult | null;
  duplicate: boolean;
};

const TOLERANCE = 1;
const PHOTO_USED_TEXT =
  "Это фото уже приложено к другой записи. Проверьте историю — возможно, запись уже есть. Разрешить повторное использование фото можно в настройках.";

export function OperationForm({
  kind,
  idempotencyKey,
  partPaymentKey,
  customers,
  suppliers,
  error,
  prefill,
  initialParty,
}: {
  kind: Operation;
  idempotencyKey: string;
  /** Ключ для оплаты части сразу при приходе — отдельная запись оплаты. */
  partPaymentKey?: string;
  customers: Customer[];
  suppliers: Party[];
  error?: string;
  prefill?: Prefill;
  /** Открыто из карточки клиента/поставщика — он уже выбран. */
  initialParty?: string;
}) {
  const hasCustomers = customers.length > 0;
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    initialParty && suppliers.some((s) => s.id === initialParty)
      ? "outgoing"
      : hasCustomers
        ? "incoming"
        : "outgoing",
  );
  const [selectedParty, setSelectedParty] = useState(
    prefill?.suggestions[0]?.id ?? initialParty ?? "",
  );
  const [amountValue, setAmountValue] = useState(prefill?.amount ?? "");
  const [paidNow, setPaidNow] = useState(false);
  const [checkedPhoto, setCheckedPhoto] = useState<CheckedPhoto | null>(null);
  const [checking, setChecking] = useState(false);
  const [shrinkingReceipt, setShrinkingReceipt] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  // Номер последнего выбранного фото: ответ по старому фото, пришедший позже,
  // не должен перезаписать результат по новому.
  const photoRequest = useRef(0);
  // Страницы накладной по порядку добавления. Исходные файлы — ужимаем при
  // каждой проверке, потому что степень сжатия зависит от числа страниц.
  const [pages, setPages] = useState<File[]>([]);
  const pagesInput = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = pages.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [pages]);
  const [similar, setSimilar] = useState<SimilarRecord[]>([]);
  const similarRequest = useRef(0);
  const checkedDocumentId = checkedPhoto?.documentId ?? null;

  // Похожие записи — пока продавец заполняет форму, до подтверждения. Пауза,
  // чтобы не спрашивать базу на каждую цифру суммы.
  useEffect(() => {
    if (kind !== "purchase" && kind !== "sale") return;
    const request = ++similarRequest.current;
    const timer = setTimeout(async () => {
      try {
        const found = await findSimilarRecords(
          kind,
          checkedDocumentId,
          selectedParty || null,
          amountValue || null,
        );
        if (request === similarRequest.current) setSimilar(found);
      } catch (err) {
        console.error("findSimilarRecords failed", err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [kind, checkedDocumentId, selectedParty, amountValue]);
  const parties =
    kind === "purchase"
      ? suppliers
      : kind === "sale"
        ? customers
        : direction === "incoming"
          ? customers
          : suppliers;
  // Лимит долга — только для продажи: предупреждаем, но не блокируем.
  const saleCustomer = kind === "sale" ? customers.find((c) => c.id === selectedParty) : undefined;
  const overLimit = saleCustomer
    ? creditLimitExceeded(
        saleCustomer.balance ?? 0,
        saleCustomer.credit_limit,
        amountFromInput(amountValue),
        paidNow,
      )
    : null;
  const confirmLabel =
    kind === "purchase"
      ? "Подтвердить приход"
      : kind === "sale"
        ? "Подтвердить продажу"
        : "Подтвердить оплату";
  const errorText =
    error === "retry"
      ? "Эта запись уже отправлялась. Обновите страницу и проверьте историю."
      : error === "duplicate"
        ? "Такой номер перевода уже учтён."
        : error === "photo"
          ? "Приложите фото накладной — без него запись не сохранится."
          : error === "photo_used"
            ? PHOTO_USED_TEXT
            : error === "photo_upload"
              ? "Не удалось загрузить фото. Попробуйте ещё раз."
          : error === "part"
            ? "Оплаченная часть не может быть больше суммы прихода."
          : error === "date"
            ? "Проверьте дату оплаты: не позже текущего момента и не раньше чем год назад."
          : error === "invalid"
            ? "Проверьте сумму и выбранного контрагента."
            : error === "save"
              ? "Не удалось сохранить запись. Проверьте данные и попробуйте снова."
              : undefined;

  function addPages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    const next = [...pages, ...picked].slice(0, MAX_PAGES);
    setPages(next);
    void checkPages(next);
    if (pages.length + picked.length > MAX_PAGES)
      setCheckNote(`Не больше ${MAX_PAGES} страниц в одной накладной — лишние не добавлены.`);
  }

  function removePage(index: number) {
    const next = pages.filter((_, i) => i !== index);
    setPages(next);
    void checkPages(next);
  }

  /** Страницы — в скрытое поле формы: если проверка не успела загрузить их, уйдут при подтверждении. */
  function fillPagesInput(files: File[]) {
    if (!pagesInput.current) return;
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      pagesInput.current.files = transfer.files;
    } catch {
      // Старый браузер без DataTransfer — останется только проверка до подтверждения.
    }
  }

  async function checkPages(next: File[]) {
    const request = ++photoRequest.current;
    setCheckedPhoto(null);
    setCheckNote(null);
    if (!next.length || (kind !== "purchase" && kind !== "sale")) {
      fillPagesInput([]);
      setChecking(false);
      return;
    }
    // Пока фото ужимаются, загружаются и распознаются, подтверждение
    // заблокировано: иначе запись уходит без document_id и те же фото
    // грузятся второй раз.
    setChecking(true);
    try {
      const shrunk = await Promise.all(
        next.map((file) => shrinkImage(file, next.length > 1 ? MULTI_PAGE_MAX_SIDE : undefined)),
      );
      if (request !== photoRequest.current) return;
      if (shrunk.reduce((size, file) => size + file.size, 0) > MAX_UPLOAD_BYTES) {
        setCheckNote("Файлы слишком большие (больше 4 МБ вместе). Уберите страницу или приложите PDF поменьше.");
        fillPagesInput([]);
        return;
      }
      fillPagesInput(shrunk);
      const fd = new FormData();
      shrunk.forEach((file) => fd.append("photo", file));
      const res = await recognizeInvoicePhoto(kind, fd);
      if (request !== photoRequest.current) return;
      if (res.ok) {
        setCheckedPhoto({
          documentId: res.documentId,
          result: res.result,
          duplicate: res.duplicate,
        });
      } else if (res.error === "photo_used") {
        setCheckNote(PHOTO_USED_TEXT);
      } else if ("documentId" in res && res.documentId) {
        setCheckedPhoto({
          documentId: res.documentId,
          result: null,
          duplicate: res.duplicate ?? false,
        });
        setCheckNote("Не удалось быстро сверить сумму — сверим после сохранения.");
      }
      // upload_failed без documentId — страницы уйдут при подтверждении из скрытого поля.
    } catch (err) {
      console.error("recognizeInvoicePhoto failed", err);
      if (request === photoRequest.current)
        setCheckNote("Не удалось быстро сверить сумму — сверим после сохранения.");
    } finally {
      if (request === photoRequest.current) setChecking(false);
    }
  }

  const checkMismatch =
    checkedPhoto?.result && amountValue
      ? Math.abs(checkedPhoto.result.total_computed - Number(amountValue.replace(",", "."))) >
        TOLERANCE
      : false;

  return (
    <>
      {kind === "payment" && !prefill && (
        <form action={prepareReceiptPayment} className="receipt-intake-form">
          <label className="photo-field">
            Есть фото, скриншот или PDF квитанции? Сумму и клиента подставим сами.
            <input
              name="photo"
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={async (e) => {
                setShrinkingReceipt(true);
                try {
                  await shrinkInputFile(e.target);
                } finally {
                  setShrinkingReceipt(false);
                }
              }}
            />
          </label>
          <button className="button" type="submit" disabled={shrinkingReceipt}>
            {shrinkingReceipt ? "Готовим фото…" : "Распознать квитанцию"}
          </button>
        </form>
      )}
      <form action={commitOperation} className="simple-operation-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        {kind === "purchase" && partPaymentKey && (
          <input type="hidden" name="part_payment_key" value={partPaymentKey} />
        )}
        {prefill && <input type="hidden" name="document_id" value={prefill.documentId} />}
        {checkedPhoto && <input type="hidden" name="document_id" value={checkedPhoto.documentId} />}
        {checkedPhoto?.result && (
          <input
            type="hidden"
            name="recognized_result"
            value={JSON.stringify(checkedPhoto.result)}
          />
        )}
        {errorText && (
          <p className="form-error" role="alert">
            {errorText}
          </p>
        )}
        {kind === "payment" && (
          <fieldset className="payment-direction">
            <legend>Кому передали деньги?</legend>
            <label>
              <input
                type="radio"
                name="direction"
                value="incoming"
                checked={direction === "incoming"}
                disabled={!hasCustomers}
                onChange={() => setDirection("incoming")}
              />
              Получили от клиента
            </label>
            <label>
              <input
                type="radio"
                name="direction"
                value="outgoing"
                checked={direction === "outgoing"}
                disabled={suppliers.length === 0}
                onChange={() => setDirection("outgoing")}
              />
              Заплатили поставщику
            </label>
          </fieldset>
        )}
        {prefill && prefill.suggestions.length > 0 && direction === "incoming" && (
          <div className="party-suggestions">
            <span className="muted">Похоже, это:</span>
            <div className="party-suggestions-list">
              {prefill.suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`party-suggestion${selectedParty === s.id ? " active" : ""}`}
                  onClick={() => setSelectedParty(s.id)}
                >
                  {s.name} · {money(s.balance)}
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          {kind === "purchase"
            ? "Поставщик"
            : kind === "sale"
              ? "Клиент"
              : direction === "incoming"
                ? "Клиент"
                : "Поставщик"}
          <select
            name={kind === "purchase" ? "supplier_id" : kind === "sale" ? "customer_id" : "party_id"}
            required
            value={selectedParty}
            onChange={(e) => setSelectedParty(e.target.value)}
          >
            <option value="">Выберите из списка</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
              </option>
            ))}
          </select>
        </label>
        <label className="amount-field">
          Сколько сом?
          <input
            name={kind === "payment" ? "amount" : "total"}
            inputMode="decimal"
            autoComplete="off"
            required
            pattern="[0-9 ]+([.,][0-9]{1,2})?"
            placeholder="0"
            value={amountValue}
            onChange={(e) => setAmountValue(e.target.value)}
            aria-label="Сумма в сомах"
          />
        </label>
        {(kind === "purchase" || kind === "sale") && (
          <div className="photo-check">
            {checking && <p className="muted">Проверяем фото…</p>}
            {checkNote && <p className="muted">{checkNote}</p>}
            {similar.length > 0 && (
              <div className="photo-check-mismatch" role="status">
                Похоже, такая запись уже есть:
                <ul>
                  {similar.map((record) => (
                    <li key={record.id}>
                      {new Date(record.occurredAt).toLocaleDateString("ru-RU", {
                        timeZone: "Asia/Bishkek",
                      })}{" "}
                      · {record.party} · {money(record.total)}
                      {record.reason === "content"
                        ? " — те же позиции в накладной"
                        : " — тот же контрагент и сумма"}
                      {record.documentId && (
                        <>
                          {" · "}
                          <Link href={`/documents/${record.documentId}`} target="_blank">
                            открыть
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                Если это новая запись — просто подтвердите.
              </div>
            )}
            {checkedPhoto?.duplicate && (
              <p className="photo-check-mismatch">
                Это фото уже приложено к другой записи — сохранится как дубликат.
              </p>
            )}
            {checkedPhoto?.result && (
              <p className={checkMismatch ? "photo-check-mismatch" : "photo-check-ok"}>
                По фото распознано: {money(checkedPhoto.result.total_computed)}
                {checkMismatch && amountValue ? " — отличается от введённой суммы" : " — совпадает"}
                {!amountValue && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setAmountValue(String(checkedPhoto.result!.total_computed))
                      }
                    >
                      Подставить
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {kind === "purchase" && (
          <label>
            Сразу оплатили поставщику, сом (необязательно)
            <input
              name="paid_now"
              inputMode="decimal"
              autoComplete="off"
              pattern="[0-9 ]+([.,][0-9]{1,2})?"
              placeholder="0"
            />
            <small className="muted">
              Запишем оплату поставщику вместе с приходом — долг перед ним вырастет только на остаток.
            </small>
          </label>
        )}
        {kind === "sale" && (
          <label className="cash-toggle">
            <input
              type="checkbox"
              name="paid_immediately"
              value="true"
              checked={paidNow}
              onChange={(e) => setPaidNow(e.target.checked)}
            />
            Клиент оплатил наличными
          </label>
        )}
        {overLimit && (
          <p className="form-error limit-warning" role="alert">
            {overLimit.alreadyOver && !amountFromInput(amountValue)
              ? `Долг клиента уже ${money(overLimit.debtAfter)} — больше лимита ${money(overLimit.limit)}.`
              : `Долг станет ${money(overLimit.debtAfter)} — больше лимита ${money(overLimit.limit)}.`}{" "}
            Продать можно, но проверьте, стоит ли давать в долг.
          </p>
        )}
        {kind === "payment" && (
          <label>
            Номер перевода (если есть)
            <input
              name="bank_reference"
              maxLength={200}
              autoComplete="off"
              placeholder="Необязательно"
              defaultValue={prefill?.bankRef}
            />
          </label>
        )}
        {kind === "payment" && (
          <label>
            {prefill?.date ? "Дата и время перевода (из чека)" : "Дата и время оплаты"}
            <input name="occurred_at" type="datetime-local" defaultValue={prefill?.date} />
            {!prefill?.date && <small className="muted">Пусто — запишем текущее время.</small>}
          </label>
        )}
        {!prefill && kind === "payment" && (
          <label className="photo-field">
            Фото или PDF чека
            <input
              name="photo"
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={(e) => void shrinkInputFile(e.target)}
            />
          </label>
        )}
        {kind !== "payment" && (
          <div className="photo-field">
            <span>
              Фото накладной
              {pages.length > 0 && <span className="muted"> · страниц: {pages.length}</span>}
            </span>
            {pages.length > 0 && (
              <ol className="page-thumbs">
                {pages.map((file, i) => (
                  <li key={`${i}-${file.name}-${file.lastModified}`} className="page-thumb">
                    {isPdf(file) ? (
                      <span className="page-thumb-pdf" title={file.name}>
                        PDF
                        <small>{file.name}</small>
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      previews[i] && <img src={previews[i]} alt={`Страница ${i + 1}`} />
                    )}
                    <span className="page-thumb-n">{i + 1}</span>
                    <button
                      type="button"
                      className="page-thumb-remove"
                      aria-label={`Убрать страницу ${i + 1}`}
                      onClick={() => removePage(i)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {pages.length < MAX_PAGES && (
              <div className="page-add-actions">
                {/* Камера сразу — capture; файлом — фото из галереи или PDF. */}
                <label className="button page-add">
                  {pages.length ? "+ Сфотографировать ещё" : "Сфотографировать"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={addPages}
                  />
                </label>
                <label className="button page-add">
                  {pages.length ? "+ Добавить файл" : "Выбрать фото или PDF"}
                  <input
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    multiple
                    className="sr-only"
                    onChange={addPages}
                  />
                </label>
              </div>
            )}
            {pages.length === 0 && (
              <small className="muted">
                Накладная на нескольких листах — добавьте страницы по порядку. PDF от поставщика
                можно приложить целиком.
              </small>
            )}
            <input
              ref={pagesInput}
              // Фото уже загружены при проверке — второй раз не отправляем,
              // сервер возьмёт document_id.
              name={checkedPhoto ? undefined : "photo"}
              type="file"
              multiple
              hidden
            />
          </div>
        )}
        {prefill && (
          <p className="muted">Фото квитанции уже приложено — распознаём в фоне.</p>
        )}
        <p className="operation-hint">
          {kind === "purchase"
            ? "Сумма сразу добавится к долгу перед поставщиком. Фото — основание записи."
            : kind === "sale"
              ? "Сумма сразу добавится к долгу клиента. Если клиент заплатил — отметьте наличные."
              : "Оплата сразу уменьшит долг контрагента. Если платили переводом — приложите чек."}
        </p>
        <div className="simple-operation-actions">
          <Submit disabled={checking || (kind !== "payment" && pages.length === 0)}>
            {checking
              ? "Проверяем фото…"
              : kind !== "payment" && pages.length === 0
                ? "Приложите фото накладной"
                : confirmLabel}
          </Submit>
          <Link className="text-button" href="/money">
            Отмена
          </Link>
        </div>
      </form>
    </>
  );
}
