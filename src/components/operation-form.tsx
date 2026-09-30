"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import {
  checkExistingDocument,
  commitOperation,
  type CommitState,
  customerFromContact,
  findPaymentByReference,
  findSimilarRecords,
  type InvoiceCheck,
  type PartySuggestion,
  type ReferencePayment,
  recognizeInvoicePhoto,
  recognizeReceiptPhoto,
  type ReceiptCheck,
  switchDocumentKind,
  type SimilarRecord,
} from "@/app/(workspace)/money/actions";
import type { DocumentVerdict } from "@/lib/adre/classify";
import type { InvoiceResult } from "@/lib/adre/types";
import { Submit } from "./submit";
import { RuDateInput, bishkekNow } from "./ru-date-input";
import { ruDate } from "@/lib/ru-date";
import { ContactPicker } from "./contact-picker";
import { money } from "@/lib/format";
import {
  CURRENCIES,
  CURRENCY_SIGN,
  convertAmount,
  formatRate,
  partyCurrency,
  ratePair,
  rateInput,
  type Currency,
} from "@/lib/currency";
import { amountFromInput, creditLimitExceeded } from "@/lib/credit-limit";
import { TOLERANCE } from "@/lib/adre/reconcile";
import { MULTI_PAGE_MAX_SIDE, shrinkImage } from "@/lib/shrink-image";
import { DOCUMENT_ACCEPT, MAX_PAGES, MAX_UPLOAD_BYTES, isPdf } from "@/lib/pages";

type Operation = "purchase" | "sale" | "payment";
type Party = { id: string; name: string; currency?: string | null };
/** Официальный курс пары «1 сильная = rate слабой» (fx.ts), ключ `USD/KGS`. */
export type RateQuotes = Record<string, { rate: number; date: string; source: string }>;
/** Клиент с долгом и лимитом — для предупреждения в форме продажи. */
type Customer = Party & { balance?: string; credit_limit?: string | null };
type Suggestion = Party & { balance: string };
type Prefill = {
  documentId: string;
  amount?: string;
  bankRef?: string;
  /** Дата перевода из чека, datetime-local по Бишкеку. */
  date?: string;
  /** Валюта из чека. */
  currency?: Currency;
  suggestions: Suggestion[];
};
type CheckedPhoto = {
  documentId: string;
  result: InvoiceResult | null;
  duplicate: boolean;
  verdict: DocumentVerdict | null;
  suggestions: PartySuggestion[];
};
/** Уже загруженный документ (переведён из другой формы). */
type ExistingDocument = { documentId: string; pages: { url: string | null; mimeType: string }[] };

/** Подсказку выбираем сами, только если имя совпало почти целиком. */
const SURE_MATCH = 0.85;

const OTHER_DOCUMENT_TEXT: Record<Exclude<DocumentVerdict & { ok: false }, { reason: "direction" }>["reason"], string> = {
  receipt: "Похоже, это чек или квитанция об оплате, а не накладная.",
  statement:
    "Похоже, это выписка или акт сверки поставщика, а не накладная. Приходом его записывать не нужно — импорт сверки появится позже.",
  price_list: "Похоже, это прайс-лист, а не накладная — долг по нему не записывают.",
  notebook: "Похоже, это страница тетради долгов, а не накладная.",
  not_document: "На фото не видно документа. Сфотографируйте накладную целиком.",
};

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
  existingDocument,
  initialParty,
  shopCurrency,
  rates,
}: {
  kind: Operation;
  idempotencyKey: string;
  /** Ключ для оплаты части сразу при приходе — отдельная запись оплаты. */
  partPaymentKey?: string;
  customers: Customer[];
  suppliers: Party[];
  error?: string;
  prefill?: Prefill;
  existingDocument?: ExistingDocument;
  shopCurrency: Currency;
  rates: RateQuotes;
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
  // Валюта суммы: null — как у контрагента (валюта его долга).
  const [amountCurrency, setAmountCurrency] = useState<Currency | null>(prefill?.currency ?? null);
  // Продавец ответил «нет» на подсказку валюты с накладной.
  const [currencyDismissed, setCurrencyDismissed] = useState(false);
  // Курс, введённый продавцом; пусто — официальный (НБКР / ЦБ РФ).
  const [rateValue, setRateValue] = useState("");
  const [paidNow, setPaidNow] = useState(false);
  // Клиенты, добавленные из контактов прямо в форме (без перезагрузки).
  const [contactCustomers, setContactCustomers] = useState<Customer[]>([]);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const allCustomers = [...customers, ...contactCustomers.filter((c) => !customers.some((x) => x.id === c.id))];
  const [checkedPhoto, setCheckedPhoto] = useState<CheckedPhoto | null>(null);
  const [checking, setChecking] = useState(false);
  // Чек оплаты: выбран → сразу загружаем и распознаём (без перезагрузки).
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptCheck, setReceiptCheck] = useState<ReceiptCheck | null>(null);
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const [bankRef, setBankRef] = useState(prefill?.bankRef ?? "");
  // Дата оплаты: с чека или «сейчас» (ставится в браузере — без расхождения
  // с сервером при отрисовке); продавец может поменять.
  const [dateSeed, setDateSeed] = useState(prefill?.date ?? "");
  const [dateValue, setDateValue] = useState<string | null>(prefill?.date ?? null);
  const [dateTouched, setDateTouched] = useState(Boolean(prefill?.date));
  useEffect(() => {
    if (kind !== "payment" || prefill?.date) return;
    const now = bishkekNow();
    setDateSeed(now);
    setDateValue(now);
  }, [kind, prefill?.date]);
  useEffect(() => {
    if (!receiptFile || isPdf(receiptFile)) {
      setReceiptPreview(null);
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setReceiptPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  // Номер последнего выбранного фото: ответ по старому фото, пришедший позже,
  // не должен перезаписать результат по новому.
  const photoRequest = useRef(0);
  // Страницы накладной по порядку добавления. Исходные файлы — ужимаем при
  // каждой проверке, потому что степень сжатия зависит от числа страниц.
  const [pages, setPages] = useState<File[]>([]);
  // Фото из другой формы — пока продавец не выбрал новые.
  const [useExisting, setUseExisting] = useState(Boolean(existingDocument));
  const [switching, setSwitching] = useState(false);
  const pagesInput = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = pages.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [pages]);
  // Подтверждение без перезагрузки (ТЗ §15.5): ошибка сервера приходит в
  // форму, фото, клиент и сумма остаются. Успех — редирект на экран результата.
  const [commit, commitAction, saving] = useActionState(
    async (previous: CommitState, form: FormData): Promise<CommitState> => {
      try {
        return await commitOperation(previous, form);
      } catch (err) {
        unstable_rethrow(err);
        console.error("commitOperation failed", err);
        return { error: "network", attempt: (previous.attempt ?? 0) + 1 };
      }
    },
    {},
  );
  const [localError, setLocalError] = useState<string | null>(null);
  // Фото, загруженные неудачной попыткой, — до смены фото продавцом.
  const [discardedAttempt, setDiscardedAttempt] = useState<number | undefined>(undefined);
  const uploadedDocumentId =
    commit.documentId && commit.attempt !== discardedAttempt ? commit.documentId : null;
  const receiptDocumentId = receiptCheck?.documentId ?? null;
  // Похожие по чеку: клиенты — по отправителю, поставщики — по получателю.
  const receiptSuggestions: (Party & { balance?: string })[] = (
    prefill
      ? direction === "incoming"
        ? prefill.suggestions
        : []
      : receiptCheck?.ok
        ? (direction === "incoming" ? receiptCheck.customerIds : receiptCheck.supplierIds)
            .map((id) => (direction === "incoming" ? customers : suppliers).find((p) => p.id === id))
            .filter((p): p is Party & { balance?: string } => Boolean(p))
        : []
  );
  const commitError = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (commit.error) commitError.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [commit.attempt, commit.error]);
  const parties =
    kind === "purchase"
      ? suppliers
      : kind === "sale"
        ? allCustomers
        : direction === "incoming"
          ? customers
          : suppliers;
  // Долг ведётся в валюте контрагента; сумма может быть в другой — тогда
  // пересчёт по курсу (база считает итог сама, здесь — показать заранее).
  const debtCurrency = partyCurrency(parties.find((p) => p.id === selectedParty), shopCurrency);
  const docCurrency = amountCurrency ?? debtCurrency;
  const foreign = docCurrency !== debtCurrency;
  const [strongCurrency, weakCurrency] = ratePair(docCurrency, debtCurrency);
  const quote = foreign ? rates[`${strongCurrency}/${weakCurrency}`] : undefined;
  const rate = foreign ? rateInput(rateValue || (quote ? String(quote.rate) : "")) : null;
  const debtAmount = foreign
    ? rate
      ? convertAmount(amountFromInput(amountValue), docCurrency, debtCurrency, Number(rate))
      : 0
    : amountFromInput(amountValue);
  const similarAmount = foreign ? (debtAmount ? debtAmount.toFixed(2) : null) : amountValue || null;
  // Валюта с накладной (ТЗ §6): предлагаем, молча не подставляем.
  const recognized = checkedPhoto?.result;
  const suggestedCurrency =
    recognized && recognized.currency_evidence && recognized.currency_evidence !== "none" && !currencyDismissed
      ? (recognized.currency as Currency)
      : null;
  const currencyHint = suggestedCurrency && suggestedCurrency !== docCurrency ? suggestedCurrency : null;
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
          similarAmount,
        );
        if (request === similarRequest.current) setSimilar(found);
      } catch (err) {
        console.error("findSimilarRecords failed", err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [kind, checkedDocumentId, selectedParty, similarAmount]);
  // Номер перевода уже есть в другой оплате — «Дубликат» сразу, до
  // подтверждения (запишется на проверку владельцу, долг не изменится).
  const [referenceDuplicate, setReferenceDuplicate] = useState<ReferencePayment | null>(null);
  const referenceRequest = useRef(0);
  const trimmedRef = bankRef.trim();
  useEffect(() => {
    const request = ++referenceRequest.current;
    if (kind !== "payment" || !trimmedRef) {
      setReferenceDuplicate(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const found = await findPaymentByReference(trimmedRef);
        if (request === referenceRequest.current) setReferenceDuplicate(found);
      } catch (err) {
        console.error("findPaymentByReference failed", err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [kind, trimmedRef]);
  // Лимит долга — только для продажи: предупреждаем, но не блокируем.
  const saleCustomer = kind === "sale" ? allCustomers.find((c) => c.id === selectedParty) : undefined;
  const overLimit = saleCustomer
    ? creditLimitExceeded(
        saleCustomer.balance ?? 0,
        saleCustomer.credit_limit,
        debtAmount,
        paidNow,
      )
    : null;
  const verdict = checkedPhoto?.verdict ?? null;
  const confirmLabel =
    verdict && !verdict.ok
      ? kind === "purchase"
        ? "Всё равно записать приход"
        : "Всё равно записать продажу"
      : kind === "purchase"
        ? "Подтвердить приход"
        : kind === "sale"
          ? "Подтвердить продажу"
          : "Подтвердить оплату";
  const hasPhoto = pages.length > 0 || useExisting;
  const suggestions = verdict?.ok ? (checkedPhoto?.suggestions ?? []) : [];
  const partyWord =
    kind === "purchase" || (kind === "payment" && direction === "outgoing") ? "поставщика" : "клиента";
  const describeError = (error: string | undefined | null) =>
    error === "retry"
      ? "Эта запись уже сохранена — возможно, при прошлой попытке. Проверьте историю."
      : error === "amount"
        ? "Введите сумму больше нуля."
        : error === "rate"
          ? "Укажите курс — число больше нуля."
          : error === "currency"
            ? "Проверьте валюту и курс."
        : error === "party"
          ? `Выберите ${partyWord} из списка.`
          : error === "blocked"
            ? "Магазин в режиме «только просмотр» — новые записи не сохраняются. Продлите оплату."
            : error === "network"
              ? "Нет связи с сервером — запись не сохранена. Проверьте интернет и нажмите ещё раз: вторая запись не появится."
      : error === "duplicate"
        ? "Оплата с таким номером перевода уже записана — этот чек уже учтён. Проверьте историю контрагента."
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
  // Ошибка из адреса — при открытии формы (сверху); ошибка подтверждения — у кнопки.
  const errorText = describeError(error);
  const submitErrorText = describeError(localError ?? commit.error);

  const rateField = (
    <label>
      Курс: 1 {CURRENCY_SIGN[strongCurrency]} = ? {CURRENCY_SIGN[weakCurrency]}
      <input
        inputMode="decimal"
        autoComplete="off"
        value={rateValue || (quote ? formatRate(quote.rate) : "")}
        placeholder="Например, 87,80"
        onChange={(e) => {
          setRateValue(e.target.value);
          if (localError === "rate") setLocalError(null);
        }}
      />
      <small className="muted">
        {quote
          ? `${quote.source} на ${quote.date}: ${formatRate(quote.rate)}. Можно поправить.`
          : "Официальный курс сейчас недоступен — введите курс."}
      </small>
    </label>
  );
  const debtChangeLine = debtAmount > 0 && (
    <p className="photo-check-ok">
      {kind === "purchase" || (kind === "payment" && direction === "outgoing")
        ? "Долг перед поставщиком изменится на "
        : "Долг клиента изменится на "}
      {money(debtAmount, debtCurrency)} ({money(amountFromInput(amountValue), docCurrency)} по{" "}
      {formatRate(rate ?? 0)})
    </p>
  );
  // Оплата: курс, номер перевода и дата — в свёрнутом блоке «Подробности
  // оплаты»; в заголовке — что заполнено. Раскрывается сам при ошибке в нём
  // и когда курс нужно ввести вручную.
  const shownDate = dateValue ?? dateSeed;
  const moreSummary = [
    foreign && rate ? `курс ${formatRate(rate)}` : null,
    bankRef.trim() ? `№ ${bankRef.trim()}` : null,
    shownDate ? `${ruDate(shownDate)}${shownDate.length > 10 ? ` ${shownDate.slice(11, 16)}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreNeeded =
    localError === "rate" || localError === "date" || (foreign && !quote && !rateValue);
  useEffect(() => {
    if (moreNeeded) setMoreOpen(true);
  }, [moreNeeded]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    if (!amountFromInput(amountValue)) {
      setLocalError("amount");
      return;
    }
    if (foreign && !rate) {
      setLocalError("rate");
      return;
    }
    if (kind === "payment" && dateTouched && !dateValue) {
      setLocalError("date");
      return;
    }
    setLocalError(null);
    const form = new FormData(e.currentTarget);
    if (kind === "payment") {
      // Дату не меняли и чека с датой нет — сервер запишет текущее время.
      form.set("occurred_at", dateTouched && dateValue ? dateValue : "");
      // Чек не загрузился при выборе — отправляем файл вместе с оплатой.
      if (receiptFile && !receiptDocumentId && !uploadedDocumentId) form.set("photo", receiptFile);
    }
    startTransition(() => commitAction(form));
  }

  async function pickReceipt(file: File | null) {
    const request = ++photoRequest.current;
    setReceiptCheck(null);
    setDiscardedAttempt(commit.attempt);
    if (!file) {
      setReceiptFile(null);
      setCheckingReceipt(false);
      return;
    }
    // Пока чек загружается и распознаётся, подтверждение заблокировано.
    setCheckingReceipt(true);
    try {
      const shrunk = await shrinkImage(file);
      if (request !== photoRequest.current) return;
      if (shrunk.size > MAX_UPLOAD_BYTES) {
        setReceiptFile(null);
        setLocalError("photo_upload");
        return;
      }
      setReceiptFile(shrunk);
      const fd = new FormData();
      fd.append("photo", shrunk);
      const res = await recognizeReceiptPhoto(fd);
      if (request !== photoRequest.current) return;
      setReceiptCheck(res);
      if (!res.ok) return;
      // Заполняем с чека; введённое продавцом не трогаем.
      const amount = res.amount;
      const currency = res.currency;
      const ref = res.bankRef;
      if (amount) setAmountValue((prev) => (prev.trim() ? prev : amount.replace(".", ",")));
      if (currency) setAmountCurrency((prev) => prev ?? currency);
      if (ref) setBankRef((prev) => (prev.trim() ? prev : ref));
      if (res.date) {
        setDateSeed(res.date);
        setDateValue(res.date);
        setDateTouched(true);
      }
      const ids = direction === "incoming" ? res.customerIds : res.supplierIds;
      if (ids[0]) setSelectedParty((prev) => prev || ids[0]);
    } catch (err) {
      console.error("recognizeReceiptPhoto failed", err);
      if (request === photoRequest.current) setReceiptCheck({ ok: false, error: "recognition_failed" });
    } finally {
      if (request === photoRequest.current) setCheckingReceipt(false);
    }
  }

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

  function applyCheck(res: InvoiceCheck) {
    if (res.ok) {
      setCheckedPhoto({
        documentId: res.documentId,
        result: res.result,
        duplicate: res.duplicate,
        verdict: res.verdict,
        suggestions: res.suggestions,
      });
      // Контрагент с накладной почти точно есть в списке — выбираем сами,
      // если продавец ещё никого не выбрал.
      const sure = res.verdict.ok && res.suggestions[0]?.score >= SURE_MATCH ? res.suggestions[0] : null;
      if (sure) setSelectedParty((current) => current || sure.id);
    } else if (res.error === "photo_used") {
      setCheckNote(PHOTO_USED_TEXT);
    } else if (res.documentId) {
      setCheckedPhoto({
        documentId: res.documentId,
        result: null,
        duplicate: res.duplicate ?? false,
        verdict: null,
        suggestions: [],
      });
      setCheckNote("Не удалось быстро сверить сумму — сверим после сохранения.");
    }
  }

  // Документ из другой формы: распознавание берётся из кеша, фото не грузим.
  const existingId = existingDocument?.documentId;
  useEffect(() => {
    if (!existingId || (kind !== "purchase" && kind !== "sale")) return;
    const request = ++photoRequest.current;
    setChecking(true);
    checkExistingDocument(kind, existingId)
      .then((res) => {
        if (request === photoRequest.current) applyCheck(res);
      })
      .catch((err) => {
        console.error("checkExistingDocument failed", err);
        if (request === photoRequest.current)
          setCheckedPhoto({ documentId: existingId, result: null, duplicate: false, verdict: null, suggestions: [] });
      })
      .finally(() => {
        if (request === photoRequest.current) setChecking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, [existingId, kind]);

  /** «Записать как приход/продажу/оплату» — тот же документ, другая форма. */
  function switchKind(target: "purchase" | "sale" | "payment", party?: string) {
    if (!checkedPhoto) return;
    setSwitching(true);
    startTransition(async () => {
      try {
        await switchDocumentKind(checkedPhoto.documentId, target, party);
      } catch (err) {
        unstable_rethrow(err);
        console.error("switchDocumentKind failed", err);
        setSwitching(false);
        setCheckNote("Не удалось открыть другую форму. Попробуйте ещё раз.");
      }
    });
  }

  async function checkPages(next: File[]) {
    const request = ++photoRequest.current;
    setDiscardedAttempt(commit.attempt);
    setCurrencyDismissed(false);
    setUseExisting(false);
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
      applyCheck(res);
      // upload_failed без documentId — страницы уйдут при подтверждении из скрытого поля.
    } catch (err) {
      console.error("recognizeInvoicePhoto failed", err);
      if (request === photoRequest.current)
        setCheckNote("Не удалось быстро сверить сумму — сверим после сохранения.");
    } finally {
      if (request === photoRequest.current) setChecking(false);
    }
  }

  // Три суммы: строки (наш итог), «Итого» на бумаге, введённая продавцом.
  const enteredAmount = amountFromInput(amountValue);
  // Накладная без цен (только названия и количество): «0 сом» — не сумма.
  const noPrices = checkedPhoto?.result ? !(checkedPhoto.result.total_computed > 0) : false;
  const checkMismatch =
    checkedPhoto?.result && !noPrices && enteredAmount
      ? Math.abs(checkedPhoto.result.total_computed - enteredAmount) > TOLERANCE
      : false;
  const paperTotal =
    checkedPhoto?.result?.total_declared != null && checkedPhoto.result.total_declared > 0
      ? checkedPhoto.result.total_declared
      : null;
  const paperMismatch =
    paperTotal != null &&
    !noPrices &&
    Math.abs(checkedPhoto!.result!.total_computed - paperTotal) > TOLERANCE;

  return (
    <>
      <form onSubmit={submit} className="simple-operation-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        {kind === "purchase" && partPaymentKey && (
          <input type="hidden" name="part_payment_key" value={partPaymentKey} />
        )}
        {prefill && <input type="hidden" name="document_id" value={prefill.documentId} />}
        {foreign && rate && (
          <>
            <input type="hidden" name="original_currency" value={docCurrency} />
            <input type="hidden" name="fx_rate" value={rate} />
          </>
        )}
        {checkedPhoto && <input type="hidden" name="document_id" value={checkedPhoto.documentId} />}
        {!checkedPhoto && useExisting && existingDocument && (
          <input type="hidden" name="document_id" value={existingDocument.documentId} />
        )}
        {!prefill && !checkedPhoto && !useExisting && !receiptDocumentId && uploadedDocumentId && (
          <input type="hidden" name="document_id" value={uploadedDocumentId} />
        )}
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
        {!prefill && receiptDocumentId && <input type="hidden" name="document_id" value={receiptDocumentId} />}
        {kind === "payment" && !prefill && (
          <div className="photo-field receipt-field">
            <span>Чек или скриншот перевода (необязательно)</span>
            {receiptFile ? (
              <div className="receipt-picked">
                {receiptPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={receiptPreview} alt="Чек" />
                ) : (
                  <span className="page-thumb-pdf">PDF</span>
                )}
                <span className="receipt-picked-text">
                  {checkingReceipt
                    ? "Читаем чек…"
                    : receiptCheck?.ok
                      ? receiptCheck.amount
                        ? `С чека: ${money(receiptCheck.amount, receiptCheck.currency ?? docCurrency)}. Проверьте поля ниже.`
                        : "Сумму на чеке не нашли — введите вручную."
                      : receiptCheck?.error === "photo_used"
                        ? PHOTO_USED_TEXT
                        : receiptCheck?.error === "upload_failed"
                          ? "Чек не загрузился — отправим вместе с оплатой."
                          : receiptCheck
                            ? "Чек прочитать не удалось — заполните поля вручную, чек сохранится."
                            : null}
                </span>
                <button
                  type="button"
                  className="page-thumb-remove receipt-remove"
                  aria-label="Убрать чек"
                  onClick={() => void pickReceipt(null)}
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="button page-add">
                Сфотографировать или выбрать чек
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    void pickReceipt(file);
                  }}
                />
              </label>
            )}
            {!receiptFile && <small className="muted">Сумму, дату, номер перевода и клиента заполним с чека.</small>}
          </div>
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
        {receiptSuggestions.length > 0 && (
          <div className="party-suggestions">
            <span className="muted">По чеку похоже, это:</span>
            <div className="party-suggestions-list">
              {receiptSuggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`party-suggestion${selectedParty === s.id ? " active" : ""}`}
                  onClick={() => setSelectedParty(s.id)}
                >
                  {s.name}
                  {s.balance != null ? ` · ${money(s.balance, partyCurrency(s, shopCurrency))}` : ""}
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
        {verdict?.ok && verdict.counterparty && (kind === "purchase" || kind === "sale") && (
          <div className="party-suggestions">
            <span className="muted">
              На накладной: «{verdict.counterparty}»
              {suggestions.length === 0 &&
                (kind === "sale" ? " — такого клиента нет в списке." : " — такого поставщика нет в списке.")}
              {suggestions.length > 0 && " · похоже, это:"}
            </span>
            {suggestions.length > 0 && (
              <div className="party-suggestions-list">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`party-suggestion${selectedParty === s.id ? " active" : ""}`}
                    onClick={() => setSelectedParty(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {kind === "sale" && (
          <div className="contact-row">
            <ContactPicker
              label="Клиент из контактов"
              onPick={async ({ name, phone }) => {
                setContactNote("Ищем клиента…");
                const found = await customerFromContact(name, phone);
                if ("error" in found) {
                  setContactNote(
                    found.error === "name"
                      ? "У контакта нет имени — добавьте клиента вручную."
                      : "Не удалось добавить клиента. Попробуйте ещё раз.",
                  );
                  return;
                }
                setContactCustomers((list) =>
                  list.some((c) => c.id === found.id) ? list : [...list, { id: found.id, name: found.name, balance: found.balance }],
                );
                setSelectedParty(found.id);
                setContactNote(
                  found.created ? `Добавили нового клиента: ${found.name}.` : `Уже есть в списке: ${found.name}.`,
                );
              }}
            />
            {contactNote && <small className="muted">{contactNote}</small>}
          </div>
        )}
        <div className="amount-currency">
          <span className="muted">Валюта суммы:</span>
          {CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`party-suggestion${docCurrency === c ? " active" : ""}`}
              aria-pressed={docCurrency === c}
              onClick={() => {
                setAmountCurrency(c === debtCurrency ? null : c);
                setRateValue("");
              }}
            >
              {CURRENCY_SIGN[c]}
            </button>
          ))}
        </div>
        <label className="amount-field">
          Сколько, {CURRENCY_SIGN[docCurrency]}?
          <input
            name={kind === "payment" ? "amount" : "total"}
            inputMode="decimal"
            autoComplete="off"
            required
            pattern="[0-9 ]+([.,][0-9]{1,2})?"
            placeholder="0"
            value={amountValue}
            onChange={(e) => {
              setAmountValue(e.target.value);
              if (localError === "amount") setLocalError(null);
            }}
            aria-label={`Сумма, ${CURRENCY_SIGN[docCurrency]}`}
          />
        </label>
        {currencyHint && (
          <div className="photo-check-mismatch document-kind-warning" role="status">
            <p>
              Похоже, накладная в валюте {CURRENCY_SIGN[currencyHint]}
              {recognized?.currency_evidence === "symbol" ? " — так написано на документе." : " — судя по ценам."} Суммы
              на бумаге — в {CURRENCY_SIGN[currencyHint]}.
            </p>
            <div className="simple-operation-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setAmountCurrency(currencyHint === debtCurrency ? null : currencyHint);
                  setRateValue("");
                }}
              >
                Да, сумма в {CURRENCY_SIGN[currencyHint]}
              </button>
              <button type="button" className="button" onClick={() => setCurrencyDismissed(true)}>
                Нет, в {CURRENCY_SIGN[docCurrency]}
              </button>
            </div>
          </div>
        )}
        {foreign && kind !== "payment" && (
          <div className="fx-field">
            {rateField}
            {debtChangeLine}
          </div>
        )}
        {foreign && kind === "payment" && debtChangeLine}
        {(kind === "purchase" || kind === "sale") && (
          <div className="photo-check">
            {checking && <p className="muted">Проверяем фото…</p>}
            {checkNote && <p className="muted">{checkNote}</p>}
            {verdict && !verdict.ok && (
              <div className="photo-check-mismatch document-kind-warning" role="status">
                {verdict.reason === "direction" ? (
                  <p>
                    {verdict.suggestedKind === "purchase"
                      ? `Это накладная от поставщика${verdict.counterparty ? ` «${verdict.counterparty}»` : ""} вам — похоже на приход, а не продажу.`
                      : `Это накладная от вашего магазина${verdict.counterparty ? ` покупателю «${verdict.counterparty}»` : ""} — похоже на продажу, а не приход.`}
                  </p>
                ) : (
                  <p>{OTHER_DOCUMENT_TEXT[verdict.reason]}</p>
                )}
                <div className="simple-operation-actions">
                  {verdict.reason === "direction" && (
                    <button
                      type="button"
                      className="button primary"
                      disabled={switching}
                      onClick={() => {
                        const top = checkedPhoto?.suggestions[0];
                        switchKind(verdict.suggestedKind, top && top.score >= SURE_MATCH ? top.id : undefined);
                      }}
                    >
                      {switching
                        ? "Открываем…"
                        : verdict.suggestedKind === "purchase"
                          ? "Записать как приход"
                          : "Записать как продажу"}
                    </button>
                  )}
                  {verdict.reason === "receipt" && (
                    <button
                      type="button"
                      className="button primary"
                      disabled={switching}
                      onClick={() => switchKind("payment")}
                    >
                      {switching ? "Открываем…" : "Записать как оплату"}
                    </button>
                  )}
                  {verdict.reason === "notebook" && (
                    <Link className="button primary" href={`/import?kind=${kind === "purchase" ? "suppliers" : "customers"}`}>
                      Перенести долги из тетради
                    </Link>
                  )}
                </div>
                <small className="muted">Если это всё-таки накладная — просто подтвердите запись ниже.</small>
              </div>
            )}
            {checkedPhoto?.verdict?.fragment && (
              <p className="photo-check-mismatch" role="status">
                Похоже, на фото только часть накладной — добавьте остальные страницы, иначе сумма
                будет неполной.
              </p>
            )}
            {similar.length > 0 && (
              <div className="photo-check-mismatch" role="status">
                Похоже, такая запись уже есть:
                <ul>
                  {similar.map((record) => (
                    <li key={record.id}>
                      {new Date(record.occurredAt).toLocaleDateString("ru-RU", {
                        timeZone: "Asia/Bishkek",
                      })}{" "}
                      · {record.party} · {money(record.total, debtCurrency)}
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
              <div className="duplicate-warning" role="alert">
                <strong>Дубликат</strong>
                <p>Это фото уже приложено к другой записи — сохранится как дубликат. Проверьте, не задвоилось ли.</p>
              </div>
            )}
            {checkedPhoto?.result && noPrices && (
              <p className="photo-check-mismatch" role="status">
                Цен в накладной не нашли — введите сумму вручную.
                {paperTotal != null && <> «Итого» на бумаге: {money(paperTotal, docCurrency)}.</>}
              </p>
            )}
            {checkedPhoto?.result && !noPrices && (
              <p className={checkMismatch || paperMismatch ? "photo-check-mismatch" : "photo-check-ok"}>
                По строкам: {money(checkedPhoto.result.total_computed, docCurrency)}
                {paperTotal != null && <> · «Итого» на бумаге: {money(paperTotal, docCurrency)}</>}
                {enteredAmount
                  ? checkMismatch
                    ? " — отличается от введённой суммы"
                    : " — совпадает с введённой суммой"
                  : ""}
                {!amountValue && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setAmountValue(String(checkedPhoto.result!.total_computed));
                        // Сумма с накладной — в её валюте (продавец нажал сам).
                        if (suggestedCurrency) {
                          setAmountCurrency(suggestedCurrency === debtCurrency ? null : suggestedCurrency);
                          setRateValue("");
                        }
                      }}
                    >
                      Подставить
                    </button>
                  </>
                )}
              </p>
            )}
            {paperMismatch && (
              <p className="photo-check-mismatch" role="status">
                Итог на бумаге не равен сумме строк: возможно, какая-то строка не распозналась
                или в накладной ошибка в сложении. Проверьте фото и сумму.
              </p>
            )}
          </div>
        )}
        {kind === "purchase" && (
          <label>
            Сразу оплатили поставщику, {CURRENCY_SIGN[debtCurrency]} (необязательно)
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
              ? `Долг клиента уже ${money(overLimit.debtAfter, debtCurrency)} — больше лимита ${money(overLimit.limit, debtCurrency)}.`
              : `Долг станет ${money(overLimit.debtAfter, debtCurrency)} — больше лимита ${money(overLimit.limit, debtCurrency)}.`}{" "}
            Продать можно, но проверьте, стоит ли давать в долг.
          </p>
        )}
        {kind === "payment" && (referenceDuplicate || receiptCheck?.duplicate) && (
          <div className="duplicate-warning" role="alert">
            <strong>Дубликат</strong>
            {referenceDuplicate && (
              <p>
                Номер перевода {trimmedRef} уже есть в оплате от{" "}
                {new Intl.DateTimeFormat("ru-RU", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "Asia/Bishkek",
                }).format(new Date(referenceDuplicate.occurredAt))}
                {referenceDuplicate.party ? ` · ${referenceDuplicate.party}` : ""} ·{" "}
                {money(referenceDuplicate.amount, referenceDuplicate.currency)}. Если записать — оплата уйдёт владельцу
                на проверку, долг не изменится.
                {referenceDuplicate.href && (
                  <>
                    {" "}
                    <Link className="duplicate-link" href={referenceDuplicate.href} target="_blank">
                      Первая запись →
                    </Link>
                  </>
                )}
              </p>
            )}
            {receiptCheck?.duplicate && <p>Этот чек уже приложен к другой записи — проверьте, не задвоилось ли.</p>}
          </div>
        )}
        {kind === "payment" && (
          <details className="more-fields" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
            <summary>
              <span className="more-fields-title">Подробности оплаты</span>
              {!moreOpen && moreSummary && <span className="more-fields-values">{moreSummary}</span>}
            </summary>
            <div className="more-fields-body">
              {foreign && <div className="fx-field">{rateField}</div>}
              <label>
                Номер перевода (если есть)
                <input
                  name="bank_reference"
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Необязательно"
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                />
              </label>
              <RuDateInput
                label={prefill?.date || (receiptCheck?.ok && receiptCheck.date) ? "Дата и время перевода (с чека)" : "Дата и время оплаты"}
                value={dateSeed}
                withTime
                onChange={(next) => {
                  setDateValue(next);
                  setDateTouched(true);
                  if (localError === "date") setLocalError(null);
                }}
              />
            </div>
          </details>
        )}
        {kind !== "payment" && (
          <div className="photo-field">
            <span>
              Фото накладной
              {pages.length > 0 && <span className="muted"> · страниц: {pages.length}</span>}
            </span>
            {useExisting && existingDocument && pages.length === 0 && (
              <ol className="page-thumbs">
                {existingDocument.pages.map((page, i) => (
                  <li key={i} className="page-thumb">
                    {page.mimeType === "application/pdf" || !page.url ? (
                      <span className="page-thumb-pdf">{page.url ? "PDF" : "Фото"}</span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={page.url} alt={`Страница ${i + 1}`} />
                    )}
                    <span className="page-thumb-n">{i + 1}</span>
                  </li>
                ))}
              </ol>
            )}
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
            {useExisting && pages.length === 0 ? (
              <div className="page-add-actions">
                <button
                  type="button"
                  className="button page-add"
                  onClick={() => {
                    ++photoRequest.current;
                    setUseExisting(false);
                    setCheckedPhoto(null);
                    setCheckNote(null);
                    setChecking(false);
                  }}
                >
                  Заменить фото
                </button>
              </div>
            ) : pages.length < MAX_PAGES && (
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
            {pages.length === 0 && !useExisting && (
              <small className="muted">
                Накладная на нескольких листах — добавьте страницы по порядку. PDF от поставщика
                можно приложить целиком.
              </small>
            )}
            <input
              ref={pagesInput}
              // Фото уже загружены при проверке — второй раз не отправляем,
              // сервер возьмёт document_id.
              name={checkedPhoto || useExisting || uploadedDocumentId ? undefined : "photo"}
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
              : "Оплата сразу уменьшит долг контрагента."}
        </p>
        {submitErrorText && !saving && (
          <p className="form-error" role="alert" ref={commitError}>
            {submitErrorText}
          </p>
        )}
        <div className="simple-operation-actions">
          <Submit pending={saving} disabled={checking || checkingReceipt || switching || (kind !== "payment" && !hasPhoto)}>
            {checking
              ? "Проверяем фото…"
              : checkingReceipt
                ? "Читаем чек…"
              : kind !== "payment" && !hasPhoto
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
