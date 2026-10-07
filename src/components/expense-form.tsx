"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import {
  commitExpense,
  recognizeExpensePhoto,
  type ExpenseCheck,
  type ExpenseState,
} from "@/app/(workspace)/money/actions";
import { EXPENSE_CATEGORIES, isExpenseCategory, type ExpenseCategory } from "@/lib/expenses";
import { DOCUMENT_ACCEPT, MAX_PAGES, MAX_UPLOAD_BYTES, isPdf } from "@/lib/pages";
import { MULTI_PAGE_MAX_SIDE, shrinkImage } from "@/lib/shrink-image";
import { CURRENCY_SIGN, type Currency } from "@/lib/currency";
import { money } from "@/lib/format";
import { Submit } from "@/components/submit";
import { RuDateInput } from "@/components/ru-date-input";

const ERRORS: Record<string, string> = {
  amount: "Введите сумму больше нуля.",
  note: "Для «Прочее» напишите, на что потратили.",
  date: "Дата - не в будущем и не раньше чем год назад.",
  photo_upload: "Не удалось загрузить фото. Попробуйте ещё раз или запишите без фото.",
  photo_used: "Это фото уже приложено к другой записи. Выберите другое фото.",
  blocked: "Магазин в режиме «только просмотр» - новые записи недоступны.",
  retry: "Этот расход уже отправлялся. Проверьте список расходов.",
  network: "Нет связи с сервером. Нажмите «Записать» ещё раз - второй расход не появится.",
  invalid: "Проверьте сумму и категорию.",
  save: "Не удалось сохранить. Попробуйте ещё раз.",
};

const amountText = (n: number) => String(n).replace(".", ",");
const dayText = (d: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00+06:00`));

/**
 * Расход: сумма, категория, комментарий, день (сегодня, можно поменять),
 * фото по желанию. Фото сразу распознаётся — пустые поля заполняются с
 * чека. Отправка без перезагрузки — при ошибке всё введённое остаётся (как
 * в форме продажи, ТЗ §15.5).
 */
export function ExpenseForm({
  idempotencyKey,
  today,
  minDate,
  currency,
}: {
  idempotencyKey: string;
  today: string;
  minDate: string;
  currency: string;
}) {
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Поле даты показывает dateSeed (задаётся с чека), введённое — в dateValue.
  const [dateSeed, setDateSeed] = useState(today);
  const [dateValue, setDateValue] = useState<string | null>(today);
  // «Комментарий и дата» свёрнуты; раскрываются сами, когда нужны.
  const [moreOpen, setMoreOpen] = useState(false);
  const dateTouched = useRef(false);
  const [pages, setPages] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ExpenseCheck | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  // Ответ по старому набору фото, пришедший после смены фото, — не применяем.
  const photoRequest = useRef(0);
  useEffect(() => {
    const urls = pages.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [pages]);
  const [state, action, saving] = useActionState(
    async (previous: ExpenseState, form: FormData): Promise<ExpenseState> => {
      try {
        return await commitExpense(previous, form);
      } catch (err) {
        unstable_rethrow(err);
        console.error("commitExpense failed", err);
        return { error: "network", attempt: (previous.attempt ?? 0) + 1 };
      }
    },
    {},
  );
  // Фото, загруженные неудачной попыткой записи, — пока фото не меняли.
  const [discardedAttempt, setDiscardedAttempt] = useState<number | undefined>(undefined);
  const documentId =
    check?.documentId ?? (state.documentId && state.attempt !== discardedAttempt ? state.documentId : null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const error = localError ?? state.error ?? null;
  useEffect(() => {
    if (state.error) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.attempt, state.error]);

  /** Пустые поля — с чека; заполненные продавцом не трогаем. */
  function applyCheck(res: ExpenseCheck) {
    setCheck(res);
    if (!res.ok) return;
    const r = res.result;
    if (r.document_class === "not_document") return;
    // Функциональные обновления: продавец мог печатать, пока чек читался.
    if (r.amount > 0 && (r.currency ?? "KGS") === currency)
      setAmount((prev) => (prev.trim() ? prev : amountText(r.amount)));
    const day = res.date;
    if (day && !dateTouched.current) {
      setDateSeed(day);
      setDateValue(day);
    }
    if (isExpenseCategory(r.category)) setCategory((prev) => prev || r.category);
    const text = [r.description, r.vendor].filter(Boolean).join(" - ").slice(0, 500);
    if (text) setNote((prev) => (prev.trim() ? prev : text));
  }

  async function changePages(next: File[]) {
    const request = ++photoRequest.current;
    setCheck(null);
    setDiscardedAttempt(state.attempt);
    if (!next.length) {
      setPages([]);
      setChecking(false);
      return;
    }
    setPreparing(true);
    let shrunk: File[];
    try {
      shrunk = await Promise.all(
        next.map((file) => shrinkImage(file, next.length > 1 ? MULTI_PAGE_MAX_SIDE : undefined)),
      );
    } finally {
      setPreparing(false);
    }
    if (request !== photoRequest.current) return;
    if (shrunk.reduce((size, file) => size + file.size, 0) > MAX_UPLOAD_BYTES) {
      setLocalError("photo_upload");
      return;
    }
    setLocalError(null);
    setPages(shrunk);
    // Пока фото загружается и распознаётся, «Записать» заблокирована: иначе
    // фото уйдёт второй раз без document_id.
    setChecking(true);
    try {
      const fd = new FormData();
      shrunk.forEach((file) => fd.append("photo", file));
      const res = await recognizeExpensePhoto(fd);
      if (request === photoRequest.current) applyCheck(res);
    } catch (err) {
      console.error("recognizeExpensePhoto failed", err);
    } finally {
      if (request === photoRequest.current) setChecking(false);
    }
  }

  function addPages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length) void changePages([...pages, ...picked].slice(0, MAX_PAGES));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving || preparing || checking) return;
    if (!/^[0-9 ]*[0-9]([.,][0-9]{1,2})?$/.test(amount.trim()) || !/[1-9]/.test(amount)) {
      setLocalError("amount");
      return;
    }
    if (category === "other" && !note.trim()) {
      setLocalError("note");
      return;
    }
    if (!dateValue || dateValue > today || dateValue < minDate) {
      setLocalError("date");
      return;
    }
    setLocalError(null);
    const form = new FormData(e.currentTarget);
    form.set("spent_on", dateValue);
    // Фото уже загружено как документ — второй раз не отправляем.
    if (documentId) form.set("document_id", documentId);
    else for (const file of pages) form.append("photo", file);
    startTransition(() => action(form));
  }

  const recognized = check?.ok && check.result.document_class !== "not_document" ? check.result : null;
  const paperAmount = recognized && recognized.amount > 0 ? recognized.amount : null;
  const enteredAmount = Number(amount.replace(/\s/g, "").replace(",", "."));
  const amountDiffers =
    paperAmount !== null && (recognized?.currency ?? "KGS") === currency && amount.trim() !== "" && Math.abs(enteredAmount - paperAmount) > 1;

  const moreNeeded = category === "other" || localError === "note" || localError === "date";
  useEffect(() => {
    if (moreNeeded) setMoreOpen(true);
  }, [moreNeeded]);

  return (
    <form onSubmit={submit} className="simple-operation-form expense-form">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <div className="photo-field invoice-dropzone">
        <span className="invoice-dropzone-title">
          Фото чека <span className="muted">(необязательно)</span>
          {pages.length > 0 && <span className="muted"> · файлов: {pages.length}</span>}
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
                  previews[i] && <img src={previews[i]} alt={`Фото ${i + 1}`} />
                )}
                <span className="page-thumb-n">{i + 1}</span>
                <button
                  type="button"
                  className="page-thumb-remove"
                  aria-label={`Убрать фото ${i + 1}`}
                  onClick={() => void changePages(pages.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        {pages.length < MAX_PAGES && (
          <div className="page-add-actions single">
            {/* Одна кнопка: телефон сам предложит камеру, галерею или файлы. */}
            <label className="button page-add">
              {pages.length ? (
                "+ Добавить ещё фото"
              ) : (
                <>
                  <span className="page-add-long">Сфотографировать или выбрать чек</span>
                  <span className="page-add-short">Фото или файл чека</span>
                </>
              )}
              <input type="file" accept={DOCUMENT_ACCEPT} multiple className="sr-only" onChange={addPages} />
            </label>
          </div>
        )}
        {pages.length === 0 && (
          <small className="muted">Сфотографируйте чек - сумму, дату и категорию заполним сами.</small>
        )}
        {checking && <p className="muted">Читаем чек…</p>}
        {!checking && recognized && (
          <p className="notice success" role="status">
            С чека: {paperAmount !== null ? money(paperAmount, recognized.currency ?? "KGS") : "сумму не нашли"}
            {check?.ok && check.date ? ` · ${dayText(check.date)}` : ""}
            {recognized.vendor ? ` · ${recognized.vendor}` : ""}. Проверьте поля ниже.
          </p>
        )}
        {!checking && check?.ok && check.result.document_class === "not_document" && (
          <p className="notice">На фото не видно чека - заполните поля вручную.</p>
        )}
        {!checking && check && !check.ok && check.error === "recognition_failed" && (
          <p className="notice">Чек прочитать не удалось - заполните поля вручную, фото сохранится.</p>
        )}
        {!checking && check && !check.ok && check.error === "photo_used" && (
          <p className="form-error">{ERRORS.photo_used}</p>
        )}
        {!checking && check && !check.ok && check.error === "upload_failed" && (
          <p className="form-error">{ERRORS.photo_upload}</p>
        )}
        {check?.duplicate && (
          <p className="notice">Это фото уже приложено к другой записи - проверьте, не задвоилось ли.</p>
        )}
        {recognized && recognized.currency && recognized.currency !== currency && paperAmount !== null && (
          <p className="notice">
            Чек в {CURRENCY_SIGN[recognized.currency]} - введите сумму в {CURRENCY_SIGN[currency as Currency] ?? currency}.
          </p>
        )}
      </div>
      <label className="amount-field">
        Сколько потратили, {CURRENCY_SIGN[currency as Currency] ?? currency}?
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          required
          pattern="[0-9 ]+([.,][0-9]{1,2})?"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {amountDiffers && paperAmount !== null && (
        <p className="notice">
          На чеке {money(paperAmount, currency)}.{" "}
          <button type="button" className="text-button" onClick={() => setAmount(amountText(paperAmount))}>
            Подставить
          </button>
        </p>
      )}
      <fieldset className="expense-categories">
        <legend>На что</legend>
        {(Object.entries(EXPENSE_CATEGORIES) as [ExpenseCategory, string][]).map(([value, label]) => (
          <label key={value} className={category === value ? "expense-chip active" : "expense-chip"}>
            <input
              type="radio"
              name="category"
              value={value}
              required
              className="sr-only"
              checked={category === value}
              onChange={() => setCategory(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <details className="more-fields" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>
          <span className="more-fields-title">Комментарий и дата</span>
          {!moreOpen && (
            <span className="more-fields-values">
              {[dateValue ? (dateValue === today ? "сегодня" : dayText(dateValue)) : null, note.trim() || null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </summary>
        <div className="more-fields-body">
          <label>
            Комментарий{category === "other" ? " (обязательно)" : " (необязательно)"}
            <input
              name="note"
              maxLength={500}
              required={category === "other"}
              placeholder={category === "other" ? "На что потратили" : "Например: аренда за октябрь"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <RuDateInput
            label="Дата"
            value={dateSeed}
            onChange={(next) => {
              dateTouched.current = true;
              setDateValue(next);
              if (localError === "date") setLocalError(null);
            }}
          />
        </div>
      </details>
      {error && !saving && (
        <p className="form-error" role="alert" ref={errorRef}>
          {ERRORS[error] ?? ERRORS.save}
        </p>
      )}
      <div className="simple-operation-actions">
        <Submit pending={saving} disabled={preparing || checking}>
          {preparing ? "Готовим фото…" : checking ? "Читаем чек…" : "Записать расход"}
        </Submit>
      </div>
      <p className="operation-hint">Расход уменьшит деньги за день в «Итоге дня». Долги клиентов и поставщиков не меняются.</p>
    </form>
  );
}
