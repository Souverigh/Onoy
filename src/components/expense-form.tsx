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
 * Расход (вид — по макету 29.10.2026, сжат 28.10.2026): чек и день кнопкой в
 * одну строку, под ними что вышло с чека, сумма, «На что потратили?» списком,
 * комментарий свёрнут, внизу — итог и «Записать расход». На компьютере подписи
 * слева, поля справа (как у оплаты). Фото по желанию. Фото сразу распознаётся — пустые поля заполняются с
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
  // Ключ от двойной записи — один на всю жизнь формы: перерисовка страницы
  // (после «+ Новый клиент» и т.п.) присылает новый, но повтор после сбоя
  // связи должен уйти с тем же, иначе запись задвоится.
  const [idempotencyKeyPinned] = useState(idempotencyKey);
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Поле даты показывает dateSeed (задаётся с чека), введённое — в dateValue.
  const [dateSeed, setDateSeed] = useState(today);
  const [dateValue, setDateValue] = useState<string | null>(today);
  // Комментарий свёрнут; раскрывается сам, когда нужен («Прочее»).
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

  const moreNeeded = category === "other" || localError === "note";
  useEffect(() => {
    if (moreNeeded) setMoreOpen(true);
  }, [moreNeeded]);

  return (
    <form onSubmit={submit} className="simple-operation-form expense-form">
      <input type="hidden" name="idempotency_key" value={idempotencyKeyPinned} />
      {/* Верх: чек слева, день кнопкой справа; на телефоне без чека полоса
          «Заполнить по чеку» уходит под день (row-reverse + перенос). */}
      <div className="expense-head">
        <details className="more-menu pay-date" open={localError === "date" || undefined}>
          <summary className="pay-date-chip">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6h16v15H4V6Zm0 5h16M8 3v5m8-5v5" />
            </svg>
            <span>{!dateValue || dateValue === today ? "Сегодня" : dayText(dateValue)}</span>
            <span aria-hidden="true">▾</span>
          </summary>
          <div className="more-menu-list pay-date-panel">
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
        <div className="photo-field expense-photo">
          <span className="expense-label">Чек</span>
          {pages.length === 0 ? (
            // Одна кнопка-полоса: телефон сам предложит камеру, галерею или файлы.
            <label className="expense-scan">
              <span className="expense-scan-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7h4l2-3h6l2 3h4v14H3V7Zm9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
                </svg>
              </span>
              <span className="expense-scan-text">
                <b>Заполнить по чеку</b>
                <small>Необязательно · Сумма, дата и категория заполнятся автоматически</small>
              </span>
              <input type="file" accept={DOCUMENT_ACCEPT} multiple className="sr-only" onChange={addPages} />
            </label>
          ) : (
            // Чек — маленькие миниатюры, рядом имя файла и «+ Добавить фото».
            <div className="expense-file">
              <ol className="page-thumbs">
                {pages.map((file, i) => (
                  <li key={`${i}-${file.name}-${file.lastModified}`} className="page-thumb">
                    {isPdf(file) ? (
                      <span className="page-thumb-pdf" title={file.name}>
                        PDF
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      previews[i] && <img src={previews[i]} alt={`Фото ${i + 1}`} />
                    )}
                    {pages.length > 1 && <span className="page-thumb-n">{i + 1}</span>}
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
              <span className="expense-file-text">
                <b>Чек</b>
                <span className="muted">{pages.length === 1 ? pages[0].name : `файлов: ${pages.length}`}</span>
                {pages.length < MAX_PAGES && (
                  <label className="text-button expense-photo-more">
                    + Добавить фото
                    <input type="file" accept={DOCUMENT_ACCEPT} multiple className="sr-only" onChange={addPages} />
                  </label>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
      {/* Что вышло с чека — сразу под ним, сообщения вплотную друг к другу. */}
      {(checking || check || recognized) && (
        <div className="expense-msgs">
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
      )}
      <label className="amount-field">
        <span>Сумма расхода, {CURRENCY_SIGN[currency as Currency] ?? currency}</span>
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
        <p className="notice expense-amount-tip">
          На чеке {money(paperAmount, currency)}.{" "}
          <button type="button" className="text-button" onClick={() => setAmount(amountText(paperAmount))}>
            Подставить
          </button>
        </p>
      )}
      <label className="expense-category">
        <span>На что потратили?</span>
        <select
          name="category"
          required
          value={category}
          onChange={(e) => setCategory(isExpenseCategory(e.target.value) ? e.target.value : "")}
        >
          <option value="" disabled>
            Выберите
          </option>
          {(Object.entries(EXPENSE_CATEGORIES) as [ExpenseCategory, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <details className="more-fields expense-note" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>
          <span className="more-fields-title">
            Комментарий{category === "other" ? " (обязательно)" : " (необязательно)"}
          </span>
          {!moreOpen && note.trim() && <span className="more-fields-values">{note.trim()}</span>}
        </summary>
        <div className="more-fields-body">
          <input
            name="note"
            maxLength={500}
            required={category === "other"}
            aria-label="Комментарий"
            placeholder={category === "other" ? "На что потратили" : "Например: аренда за октябрь"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </details>
      {error && !saving && (
        <p className="form-error" role="alert" ref={errorRef}>
          {ERRORS[error] ?? ERRORS.save}
        </p>
      )}
      <div className="expense-bar">
        <div className="expense-bar-total">
          <span className="muted">Итого</span>
          <strong>{enteredAmount > 0 ? money(enteredAmount, currency) : "-"}</strong>
        </div>
        <Submit pending={saving} disabled={preparing || checking}>
          {preparing ? "Готовим фото…" : checking ? "Читаем чек…" : "Записать расход"}
        </Submit>
      </div>
      <p className="operation-hint">
        {enteredAmount > 0 ? `В итоге дня: −${money(enteredAmount, currency)}.` : "Расход уменьшит деньги за день в «Итоге дня»."} Долги
        клиентов и поставщиков не меняются.
      </p>
    </form>
  );
}
