"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import {
  commitPurchaseItems,
  commitSaleItems,
  quickAddProduct,
  type QuickProduct,
  type SaleItemsState,
} from "@/app/(workspace)/stock/actions";
import { customerFromContact } from "@/app/(workspace)/money/actions";
import { saveDraft } from "@/app/(workspace)/drafts/actions";
import type { Draft, DraftData } from "@/lib/drafts";
import { Submit } from "./submit";
import { ContactPicker } from "./contact-picker";
import { PartyPicker } from "./party-picker";
import { NewCustomerInline } from "./new-customer-inline";
import { DatePicker } from "./date-picker";
import { money, quantity } from "@/lib/format";
import { searchProducts } from "@/lib/match";
import { PRODUCT_UNITS, STOCK_ERROR_TEXT, stockNumber } from "@/lib/stock";
import { CURRENCY_SIGN, convertAmount, formatRate, isCurrency, partyCurrency, ratePair, rateInput, type Currency } from "@/lib/currency";
import { creditLimitExceeded } from "@/lib/credit-limit";
import type { RateQuotes } from "./operation-form";

type Customer = {
  id: string;
  name: string;
  phone?: string | null;
  aliases?: string[] | null;
  currency?: string | null;
  balance?: string;
  credit_limit?: string | null;
};
type Line = { key: number; product: QuickProduct; qty: string; price: string };

/** Количество в тысячных, цена в тийынах — сумма строки как в базе: round(qty*price, 2). */
function lineSum(qty: string, price: string): number {
  const q = stockNumber(qty, 3);
  const p = stockNumber(price, 2);
  if (q === null || p === null) return 0;
  return Math.round(Math.round(Number(q) * 1000) * Math.round(Number(p) * 100) / 1000) / 100;
}

/** «85.50» → «85,5» для поля ввода. */
const asInput = (value: string) => String(Number(value)).replace(".", ",");

const ERROR_TEXT: Record<string, string> = {
  lines: "Добавьте хотя бы один товар.",
  qty: "Проверьте количество - число больше нуля.",
  price: "Проверьте цены - число не меньше нуля.",
  cost: "Укажите цену закупки у каждого товара.",
  rate: "Укажите курс - число больше нуля.",
  too_many: "В одной накладной - не больше 200 строк.",
  date: "Проверьте дату: не позже сегодняшнего дня и не раньше чем год назад.",
};
const NETWORK_TEXT = {
  sale: "Нет связи с сервером - продажа не сохранена. Проверьте интернет и нажмите ещё раз: вторая запись не появится.",
  purchase: "Нет связи с сервером - приход не сохранён. Проверьте интернет и нажмите ещё раз: вторая запись не появится.",
};

/**
 * Накладная товарами со склада: продажа клиенту (остаток уменьшается, цена —
 * продажная) или приход от поставщика (остаток растёт, цена — закупочная).
 */
export function SaleItemsForm({
  kind = "sale",
  customers,
  products: initialProducts,
  shopCurrency,
  rates,
  idempotencyKey,
  initialParty,
  draft,
}: {
  kind?: "sale" | "purchase";
  /** Клиенты для продажи, поставщики для прихода. */
  customers: Customer[];
  products: QuickProduct[];
  shopCurrency: Currency;
  rates: RateQuotes;
  idempotencyKey: string;
  initialParty?: string;
  /** Продолжить черновик: форма открывается с тем, что было введено. */
  draft?: Draft;
}) {
  // Ключ от двойной записи — один на всю жизнь формы: перерисовка страницы
  // (после «+ Новый клиент» и т.п.) присылает новый, но повтор после сбоя
  // связи должен уйти с тем же, иначе запись задвоится.
  const [idempotencyKeyPinned] = useState(idempotencyKey);
  const purchase = kind === "purchase";
  const priceOf = (p: QuickProduct) => (purchase ? p.purchase_price : p.sale_price);
  const priceCurrencyOf = (p: QuickProduct): Currency =>
    purchase && isCurrency(p.purchase_currency) ? p.purchase_currency : shopCurrency;
  const [products, setProducts] = useState(initialProducts);
  const [contactCustomers, setContactCustomers] = useState<Customer[]>([]);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const allCustomers = [...customers, ...contactCustomers.filter((c) => !customers.some((x) => x.id === c.id))];
  const [party, setParty] = useState(draft?.data.party ?? initialParty ?? "");
  // «+ Новый клиент» / «+ Новый поставщик» открыт: имя — что набрали в поиске.
  const [newCustomer, setNewCustomer] = useState<string | null>(null);
  // Строки черновика: товар — свежий со склада (остаток, цены), иначе снимок.
  const [lines, setLines] = useState<Line[]>(() =>
    (draft?.data.lines ?? []).map((l, i) => ({
      key: i + 1,
      product: initialProducts.find((p) => p.id === l.product.id) ?? l.product,
      qty: l.qty,
      price: l.price,
    })),
  );
  const lineKey = useRef(draft?.data.lines.length ?? 0);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [paidNow, setPaidNow] = useState(draft?.data.paidNow ?? false);
  // Дата записи: пусто — сегодня; «забыл записать вчера» — другой день.
  const [recordDate, setRecordDate] = useState(draft?.data.recordDate ?? "");
  const [rateValue, setRateValue] = useState(draft?.data.rate ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  // Новый товар прямо отсюда, если поиск ничего не нашёл.
  const [creating, setCreating] = useState<{ name: string; unit: string; price: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const [state, commit, saving] = useActionState(async (previous: SaleItemsState, form: FormData) => {
    try {
      return await (purchase ? commitPurchaseItems : commitSaleItems)(previous, form);
    } catch (err) {
      unstable_rethrow(err);
      console.error(purchase ? "commitPurchaseItems failed" : "commitSaleItems failed", err);
      return { error: "network", attempt: (previous.attempt ?? 0) + 1 };
    }
  }, {});
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.attempt, state.error]);

  const customer = allCustomers.find((c) => c.id === party);
  const debtCurrency = partyCurrency(customer, shopCurrency);
  const foreign = debtCurrency !== shopCurrency;
  // Приход — цены в валюте поставщика (у долларового — в $), долг без
  // курса. Продажа — цены в валюте магазина, долг клиента в другой валюте —
  // по курсу.
  const lineCurrency = purchase ? debtCurrency : shopCurrency;
  const needsRate = foreign && !purchase;
  const priceFits = (p: QuickProduct) => priceCurrencyOf(p) === lineCurrency;
  const [strong, weak] = ratePair(shopCurrency, debtCurrency);
  const quote = needsRate ? rates[`${strong}/${weak}`] : undefined;
  const rate = needsRate ? rateInput(rateValue || (quote ? String(quote.rate) : "")) : null;
  const total = Math.round(lines.reduce((s, l) => s + lineSum(l.qty, l.price), 0) * 100) / 100;
  const debt = needsRate ? (rate ? convertAmount(total, shopCurrency, debtCurrency, Number(rate)) : 0) : total;

  // Сменили поставщика на другую валюту — цены строк были в старой: ставим
  // прошлую закупку в новой валюте или пусто.
  const shownCurrency = useRef(lineCurrency);
  useEffect(() => {
    if (shownCurrency.current === lineCurrency) return;
    shownCurrency.current = lineCurrency;
    setLines((all) =>
      all.map((l) => ({
        ...l,
        price: Number(priceOf(l.product)) > 0 && priceCurrencyOf(l.product) === lineCurrency ? asInput(priceOf(l.product)) : "",
      })),
    );
    // priceOf / priceCurrencyOf зависят только от kind и валюты магазина.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCurrency]);
  const overLimit = customer && !purchase ? creditLimitExceeded(customer.balance ?? 0, customer.credit_limit, debt, paidNow) : null;

  // Черновик: всё введённое сохраняется в базе само (через секунду после
  // правки, сразу — при уходе со страницы или сворачивании), чтобы переход в
  // другой раздел ничего не стирал. Запись по черновику стирает его.
  const draftId = useRef<string | null>(draft?.id ?? null);
  const draftSnapshot: DraftData = {
    party,
    partyName: customer?.name ?? "",
    lines: lines.map((l) => ({ product: l.product, qty: l.qty, price: l.price })),
    paidNow,
    recordDate,
    rate: rateValue,
    total: total.toFixed(2),
    currency: lineCurrency,
  };
  const draftJson = JSON.stringify(draftSnapshot);
  const draftLatest = useRef({ json: draftJson, data: draftSnapshot });
  draftLatest.current = { json: draftJson, data: draftSnapshot };
  // Что уже в базе; открытая и не тронутая форма черновика не создаёт.
  const draftSaved = useRef(draftJson);
  const draftSaving = useRef<Promise<void> | null>(null);
  const draftStopped = useRef(false);
  const [draftStatus, setDraftStatus] = useState<"saved" | "saving" | "error" | null>(draft ? "saved" : null);

  const flushDraft = useRef(async (): Promise<void> => {});
  flushDraft.current = async () => {
    while (draftSaving.current) await draftSaving.current;
    const { json, data } = draftLatest.current;
    if (draftStopped.current || json === draftSaved.current) return;
    // Пустую новую форму не сохраняем — черновик появляется с первой правкой.
    if (!draftId.current && !data.party && !data.lines.length) return;
    setDraftStatus("saving");
    draftSaving.current = (async () => {
      try {
        const result = await saveDraft(kind, draftId.current, data);
        if ("id" in result) {
          draftSaved.current = json;
          // Адрес страницы не меняем: с ним перерисовка страницы (после
          // «+ Новый клиент») открыла бы черновик из базы вместо формы.
          draftId.current = result.id;
          setDraftStatus(draftLatest.current.json === json ? "saved" : "saving");
        } else if (result.error === "gone") {
          draftStopped.current = true;
          setDraftStatus(null);
        } else setDraftStatus("error");
      } catch {
        setDraftStatus("error");
      } finally {
        draftSaving.current = null;
      }
    })();
    await draftSaving.current;
  };

  useEffect(() => {
    if (draftStopped.current || draftJson === draftSaved.current) return;
    const timer = setTimeout(() => void flushDraft.current(), 1000);
    return () => clearTimeout(timer);
  }, [draftJson]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushDraft.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      // Ушли в другой раздел внутри Depter — сохраняем, что не успело.
      void flushDraft.current();
    };
  }, []);

  // Запись не удалась — черновик снова сохраняется.
  useEffect(() => {
    if (state.error) draftStopped.current = false;
  }, [state.attempt, state.error]);

  const trimmed = query.trim();
  const inCart = new Set(lines.map((l) => l.product.id));
  const results = trimmed ? searchProducts(trimmed, products, 8) : [];
  // Пять частых товаров — над таблицей.
  const popular = searchProducts("", products, 5);
  // Подсказки строки ввода: выделенная (стрелки), открыты — пока в поиске есть текст.
  const [active, setActive] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const dropdownOpen = searchFocused && trimmed.length > 0 && !creating;
  const qtyInputs = useRef(new Map<number, HTMLInputElement>());
  const priceInputs = useRef(new Map<number, HTMLInputElement>());
  // Добавленная строка: курсор — в её «Кол-во».
  const [focusQty, setFocusQty] = useState<number | null>(null);
  useEffect(() => {
    if (focusQty === null) return;
    const input = qtyInputs.current.get(focusQty);
    input?.focus();
    input?.select();
    setFocusQty(null);
  }, [focusQty, lines]);

  function startCreating() {
    if (!trimmed) return;
    setCreating({ name: trimmed, unit: "шт", price: "" });
    setCreateError(null);
  }

  function add(product: QuickProduct) {
    setLocalError(null);
    const existing = lines.find((l) => l.product.id === product.id);
    if (existing) {
      // Повторное нажатие — ещё одна единица того же товара.
      const next = stockNumber(existing.qty, 3);
      setLines((all) =>
        all.map((l) => (l.key === existing.key ? { ...l, qty: asInput(String(Number(next ?? 0) + 1)) } : l)),
      );
      setFlash(existing.key);
      setFocusQty(existing.key);
    } else {
      const key = ++lineKey.current;
      setLines((all) => [...all, { key, product, qty: "1", price: Number(priceOf(product)) > 0 && priceFits(product) ? asInput(priceOf(product)) : "" }]);
      setFlash(key);
      setFocusQty(key);
    }
    setQuery("");
    setActive(0);
    setCreating(null);
  }

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [flash]);

  function update(key: number, patch: Partial<Pick<Line, "qty" | "price">>) {
    setLocalError(null);
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function step(line: Line, delta: number) {
    const current = Number(stockNumber(line.qty, 3) ?? 0);
    const next = Math.max(0, Math.round((current + delta) * 1000) / 1000);
    if (next === 0) return;
    update(line.key, { qty: asInput(String(next)) });
  }

  async function createProduct() {
    if (!creating || createSaving) return;
    if (!creating.name.trim()) {
      setCreateError("invalid_name");
      return;
    }
    setCreateSaving(true);
    setCreateError(null);
    try {
      const result = await quickAddProduct(
        purchase
          ? { name: creating.name.trim(), unit: creating.unit, salePrice: "0", purchasePrice: creating.price, purchaseCurrency: lineCurrency }
          : { name: creating.name.trim(), unit: creating.unit, salePrice: creating.price },
      );
      if ("error" in result) {
        // Такой уже есть — найдём и добавим его.
        if (result.error === "name_taken") {
          const same = products.find((p) => p.name.toLowerCase() === creating.name.trim().toLowerCase());
          if (same) return add(same);
        }
        setCreateError(result.error);
        return;
      }
      setProducts((all) => [...all, result.product]);
      add(result.product);
    } catch (err) {
      console.error("quickAddProduct failed", err);
      setCreateError("save");
    } finally {
      setCreateSaving(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    if (!party) return setLocalError("party");
    if (!lines.length) return setLocalError("lines");
    if (lines.some((l) => !(Number(stockNumber(l.qty, 3)) > 0))) return setLocalError("qty");
    if (lines.some((l) => stockNumber(l.price || "0", 2) === null)) return setLocalError("price");
    // Приход без цены закупки — себестоимость потеряется; просим указать.
    if (purchase && lines.some((l) => !l.price.trim())) return setLocalError("cost");
    if (needsRate && !rate) return setLocalError("rate");
    setLocalError(null);
    const form = new FormData(e.currentTarget);
    // Черновик в записи: дождаться его сохранения (нужен id), дальше не сохранять —
    // успешная запись его сотрёт.
    if (draftSaving.current) await draftSaving.current;
    draftStopped.current = true;
    if (draftId.current) form.set("draft_id", draftId.current);
    form.set(
      "lines",
      JSON.stringify(lines.map((l) => ({ product: l.product.id, qty: stockNumber(l.qty, 3), price: stockNumber(l.price || "0", 2) }))),
    );
    if (needsRate && rate) form.set("fx_rate", rate);
    startTransition(() => commit(form));
  }

  const error = localError ?? state.error;
  const errorText = error
    ? error === "party"
      ? purchase
        ? "Выберите поставщика из списка."
        : "Выберите клиента из списка."
      : error === "network"
        ? NETWORK_TEXT[kind]
        : (ERROR_TEXT[error] ?? STOCK_ERROR_TEXT[error] ?? STOCK_ERROR_TEXT.save)
    : null;

  return (
    <form onSubmit={submit} className="simple-operation-form sale-items-form sale-sheet-form">
      <input type="hidden" name="idempotency_key" value={idempotencyKeyPinned} />
      {recordDate && <input type="hidden" name="record_date" value={recordDate} />}
      <div className="sale-sheet-top">
      <PartyPicker
        label={purchase ? "Поставщик" : "Клиент"}
        name={purchase ? "supplier_id" : "customer_id"}
        parties={allCustomers}
        value={party}
        onChange={(id) => {
          setParty(id);
          if (id) setNewCustomer(null);
        }}
        shopCurrency={shopCurrency}
        actions={
          purchase
            ? (close, typed) => (
                <button
                  type="button"
                  className="party-picker-action"
                  onClick={() => {
                    close();
                    setNewCustomer(typed);
                  }}
                >
                  + Новый поставщик{typed ? ` «${typed}»` : ""}
                </button>
              )
            : (close, typed) => (
                <>
                  <button
                    type="button"
                    className="party-picker-action"
                    onClick={() => {
                      close();
                      setNewCustomer(typed);
                    }}
                  >
                    + Новый клиент{typed ? ` «${typed}»` : ""}
                  </button>
                  <ContactPicker
                    className="party-picker-action"
                    label="+ Клиент из контактов"
                    iosFallback={() => {
                      close();
                      setNewCustomer(typed);
                    }}
                    onPick={async ({ name, phone }) => {
                      setContactNote("Ищем клиента…");
                      const found = await customerFromContact(name, phone);
                      if ("error" in found) {
                        setContactNote(
                          found.error === "name" ? "У контакта нет имени - добавьте клиента вручную." : "Не удалось добавить клиента. Попробуйте ещё раз.",
                        );
                        return;
                      }
                      setContactCustomers((list) =>
                        list.some((c) => c.id === found.id) ? list : [...list, { id: found.id, name: found.name, balance: found.balance }],
                      );
                      setParty(found.id);
                      setNewCustomer(null);
                      setContactNote(found.created ? `Добавили нового клиента: ${found.name}.` : `Уже есть в списке: ${found.name}.`);
                    }}
                  />
                </>
              )
        }
      />
      {newCustomer != null && (
        <NewCustomerInline
          key={newCustomer}
          who={purchase ? "supplier" : "customer"}
          shopCurrency={shopCurrency}
          customers={allCustomers}
          initialName={newCustomer}
          onClose={() => setNewCustomer(null)}
          onPickExisting={(id) => {
            setParty(id);
            setNewCustomer(null);
          }}
          onCreated={(created) => {
            setContactCustomers((list) => [...list, created]);
            setParty(created.id);
            setNewCustomer(null);
            setContactNote(`Добавили ${purchase ? "нового поставщика" : "нового клиента"}: ${created.name}.`);
          }}
        />
      )}
      {contactNote && <small className="muted contact-note">{contactNote}</small>}
      {/* Дата — наверху и заметно (просьба пользователя 17.10.2026). */}
      <DatePicker
        variant="field"
        value={recordDate}
        onChange={(next) => {
          setRecordDate(next);
          if (localError === "date") setLocalError(null);
        }}
      />
      </div>

      {/* Накладная таблицей, как в 1С (просьба пользователя 17.10.2026): сверху
          частые товары, последняя строка — поиск. Название → Enter → цена
          подставилась, курсор в «Кол-во» → Enter → снова поиск новой строки. */}
      <div className="sale-sheet">
        {popular.length > 0 && (
          <div className="sale-sheet-popular">
            <span className="muted">Частые:</span>
            <ul className="product-results product-chips">
              {popular.map((p) => (
                <li key={p.id}>
                  <button type="button" className={inCart.has(p.id) ? "in-cart" : ""} onClick={() => add(p)}>
                    <span className="product-result-name">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="sale-sheet-table">
          <div className="sale-sheet-row sale-sheet-head" aria-hidden="true">
            <span>№</span>
            <span>Товар</span>
            <span>Кол-во</span>
            <span>Ед.</span>
            <span>{purchase ? "Цена закупки" : "Цена"}</span>
            <span>Сумма</span>
            <span />
          </div>
          <ol className="sale-sheet-lines">
            {lines.map((line, i) => {
              const qtyNum = Number(stockNumber(line.qty, 3) ?? 0);
              const short = !purchase && qtyNum > Number(line.product.stock);
              const otherPrice =
                Number(priceOf(line.product)) > 0 &&
                (priceFits(line.product)
                  ? line.price && stockNumber(line.price, 2) !== null && Number(stockNumber(line.price, 2)) !== Number(priceOf(line.product))
                  : true);
              return (
                <li key={line.key} className={flash === line.key ? "sale-sheet-row sale-sheet-line flash" : "sale-sheet-row sale-sheet-line"}>
                  <span className="sale-sheet-n">{i + 1}</span>
                  <span className="sale-sheet-name">
                    <strong>{line.product.name}</strong>
                    {short && (
                      <small className="warning">
                        На складе {quantity(line.product.stock)} {line.product.unit} - остаток уйдёт в минус.
                      </small>
                    )}
                    {otherPrice && (
                      <small className="muted">
                        {purchase ? "Прошлая закупка" : "Цена на складе"} - {money(priceOf(line.product), priceCurrencyOf(line.product))}.
                      </small>
                    )}
                    {purchase && !line.price && <small className="muted">Укажите цену закупки.</small>}
                  </span>
                  <span className="qty-stepper sale-sheet-qty">
                    <button type="button" tabIndex={-1} aria-label="Меньше" onClick={() => step(line, -1)}>
                      −
                    </button>
                    <input
                      ref={(el) => {
                        if (el) qtyInputs.current.set(line.key, el);
                        else qtyInputs.current.delete(line.key);
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`Количество, ${line.product.unit}`}
                      value={line.qty}
                      onChange={(e) => update(line.key, { qty: e.target.value })}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        // Enter — дальше: цены нет — в цену, иначе — в поиск новой строки.
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (!line.price.trim()) priceInputs.current.get(line.key)?.focus();
                        else searchInput.current?.focus();
                      }}
                    />
                    <button type="button" tabIndex={-1} aria-label="Больше" onClick={() => step(line, 1)}>
                      +
                    </button>
                  </span>
                  <span className="sale-sheet-unit muted">{line.product.unit}</span>
                  <input
                    ref={(el) => {
                      if (el) priceInputs.current.set(line.key, el);
                      else priceInputs.current.delete(line.key);
                    }}
                    className="sale-sheet-price"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`Цена за ${line.product.unit}, ${CURRENCY_SIGN[lineCurrency]}`}
                    value={line.price}
                    onChange={(e) => update(line.key, { price: e.target.value })}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      searchInput.current?.focus();
                    }}
                  />
                  <span className="sale-sheet-sum">{money(lineSum(line.qty, line.price).toFixed(2), lineCurrency)}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="sale-line-remove"
                    aria-label={`Убрать ${line.product.name}`}
                    onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {/* Пустая строка ввода: поиск товара по названию или коду. */}
            <li className="sale-sheet-row sale-sheet-entry">
              <span className="sale-sheet-n">{lines.length + 1}</span>
              <span className="sale-sheet-search">
                <input
                  id="product-search"
                  ref={searchInput}
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={dropdownOpen}
                  aria-controls="product-search-results"
                  aria-label="Товар: название или код"
                  placeholder={lines.length ? "Следующий товар: название или код" : "Товар: название или код"}
                  value={query}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                    setCreating(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      if (!dropdownOpen) return;
                      e.preventDefault();
                      const count = results.length + 1;
                      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
                    } else if (e.key === "Enter") {
                      // Enter добавляет выбранный товар, а не отправляет форму.
                      e.preventDefault();
                      if (!trimmed) return;
                      if (active < results.length) add(results[active]);
                      else startCreating();
                    } else if (e.key === "Escape") {
                      setQuery("");
                    }
                  }}
                />
                {dropdownOpen && (
                  <ul id="product-search-results" className="product-results sale-sheet-dropdown" role="listbox">
                    {results.map((p, i) => (
                      <li key={p.id} role="option" aria-selected={i === active}>
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`${i === active ? "active" : ""} ${inCart.has(p.id) ? "in-cart" : ""}`}
                          // Не терять фокус поиска до клика.
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => add(p)}
                        >
                          <span className="product-result-name">{p.name}</span>
                          <small className="muted">
                            {p.sku ? `${p.sku} · ` : ""}
                            {Number(priceOf(p)) > 0 ? `${purchase ? "закупка " : ""}${money(priceOf(p), priceCurrencyOf(p))} · ` : ""}есть{" "}
                            {quantity(p.stock)} {p.unit}
                          </small>
                        </button>
                      </li>
                    ))}
                    <li role="option" aria-selected={active === results.length}>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={`product-new ${active === results.length ? "active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(results.length)}
                        onClick={startCreating}
                      >
                        + Новый товар «{trimmed}»
                      </button>
                    </li>
                  </ul>
                )}
              </span>
            </li>
          </ol>
        </div>
        {products.length === 0 && !trimmed && (
          <small className="muted">На складе пока нет товаров - начните вводить название, добавим новый.</small>
        )}
        {creating && (
          <div className="product-create">
            <label>
              Название
              <input value={creating.name} maxLength={160} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            </label>
            <div className="product-create-row">
              <label>
                Единица
                <select value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value })}>
                  {PRODUCT_UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label>
                {purchase ? "Цена закупки" : "Цена"}, {CURRENCY_SIGN[lineCurrency]}
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={creating.price}
                  onChange={(e) => setCreating({ ...creating, price: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void createProduct();
                    }
                  }}
                />
              </label>
            </div>
            {createError && (
              <p className="form-error" role="alert">
                {STOCK_ERROR_TEXT[createError] ?? STOCK_ERROR_TEXT.save}
              </p>
            )}
            <div className="simple-operation-actions">
              <button type="button" className="button primary" disabled={createSaving} onClick={() => void createProduct()}>
                {createSaving ? "Добавляем…" : "Добавить товар"}
              </button>
              <button type="button" className="text-button" onClick={() => setCreating(null)}>
                Отмена
              </button>
            </div>
          </div>
        )}
        <div className="sale-total">
          <span>Итого{lines.length ? ` · ${lines.length} ${lines.length === 1 ? "товар" : lines.length < 5 ? "товара" : "товаров"}` : ""}</span>
          <strong>{money(total.toFixed(2), lineCurrency)}</strong>
        </div>
      </div>

      <div className="sale-sheet-footer">
      <div className="sale-sheet-options">
      {purchase && foreign && (
        <p className="muted">
          Цены - в {CURRENCY_SIGN[debtCurrency]}, как у поставщика: долг ему ведётся в {CURRENCY_SIGN[debtCurrency]}, без курса.
        </p>
      )}
      {needsRate && (
        <div className="fx-field">
          <label>
            Курс: 1 {CURRENCY_SIGN[strong]} = ? {CURRENCY_SIGN[weak]}
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
              {purchase ? "Долг поставщику" : "Долг клиента"} ведётся в {CURRENCY_SIGN[debtCurrency]}.{" "}
              {quote ? `${quote.source} на ${quote.date}: ${formatRate(quote.rate)}. Можно поправить.` : "Официальный курс сейчас недоступен - введите курс."}
            </small>
          </label>
          {debt > 0 && (
            <p className="photo-check-ok">
              {purchase ? "Долг поставщику" : "Долг клиента"} изменится на {money(debt.toFixed(2), debtCurrency)}
            </p>
          )}
        </div>
      )}
      {!purchase && (
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
      </div>
      <div className="sale-sheet-submit">
      {overLimit && (
        <p className="form-error limit-warning" role="alert">
          Долг станет {money(overLimit.debtAfter, debtCurrency)} - больше лимита {money(overLimit.limit, debtCurrency)}. Продать
          можно, но проверьте, стоит ли давать в долг.
        </p>
      )}
      {errorText && !saving && (
        <p className="form-error" role="alert" ref={errorRef}>
          {errorText}
        </p>
      )}
      {draftStatus && (
        <small className="muted draft-status" role="status">
          {draftStatus === "saving"
            ? "Сохраняем черновик…"
            : draftStatus === "saved"
              ? `Черновик сохранён - найдёте его на главной в «${purchase ? "Товар от поставщика" : "Продажа"}».`
              : "Черновик не сохранился - проверьте интернет. Введённое на этом экране не пропало."}
        </small>
      )}
      <div className="simple-operation-actions">
        <Submit pending={saving} disabled={!lines.length}>
          {lines.length ? `Записать ${purchase ? "товар" : "продажу"} · ${money(total.toFixed(2), lineCurrency)}` : "Добавьте товары"}
        </Submit>
      </div>
      <p className="operation-hint">
        {purchase
          ? "Остаток на складе вырастет, цена закупки запомнится у товара, сумма добавится к долгу поставщику."
          : "Остаток на складе уменьшится, сумма добавится к долгу клиента. Клиенту можно сразу отправить накладную PDF."}
      </p>
      </div>
      </div>
    </form>
  );
}
