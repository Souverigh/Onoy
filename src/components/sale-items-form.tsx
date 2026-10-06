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
import { Submit } from "./submit";
import { ContactPicker } from "./contact-picker";
import { PartyPicker } from "./party-picker";
import { NewCustomerInline } from "./new-customer-inline";
import { money, quantity } from "@/lib/format";
import { searchProducts } from "@/lib/match";
import { PRODUCT_UNITS, STOCK_ERROR_TEXT, stockNumber } from "@/lib/stock";
import { CURRENCY_SIGN, convertAmount, formatRate, partyCurrency, ratePair, rateInput, type Currency } from "@/lib/currency";
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
  qty: "Проверьте количество — число больше нуля.",
  price: "Проверьте цены — число не меньше нуля.",
  cost: "Укажите цену закупки у каждого товара.",
  rate: "Укажите курс — число больше нуля.",
  too_many: "В одной накладной — не больше 200 строк.",
};
const NETWORK_TEXT = {
  sale: "Нет связи с сервером — продажа не сохранена. Проверьте интернет и нажмите ещё раз: вторая запись не появится.",
  purchase: "Нет связи с сервером — приход не сохранён. Проверьте интернет и нажмите ещё раз: вторая запись не появится.",
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
}: {
  kind?: "sale" | "purchase";
  /** Клиенты для продажи, поставщики для прихода. */
  customers: Customer[];
  products: QuickProduct[];
  shopCurrency: Currency;
  rates: RateQuotes;
  idempotencyKey: string;
  initialParty?: string;
}) {
  const purchase = kind === "purchase";
  const priceOf = (p: QuickProduct) => (purchase ? p.purchase_price : p.sale_price);
  const [products, setProducts] = useState(initialProducts);
  const [contactCustomers, setContactCustomers] = useState<Customer[]>([]);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const allCustomers = [...customers, ...contactCustomers.filter((c) => !customers.some((x) => x.id === c.id))];
  const [party, setParty] = useState(initialParty ?? "");
  const [newCustomer, setNewCustomer] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const lineKey = useRef(0);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [paidNow, setPaidNow] = useState(false);
  const [rateValue, setRateValue] = useState("");
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
  const [strong, weak] = ratePair(shopCurrency, debtCurrency);
  const quote = foreign ? rates[`${strong}/${weak}`] : undefined;
  const rate = foreign ? rateInput(rateValue || (quote ? String(quote.rate) : "")) : null;
  const total = Math.round(lines.reduce((s, l) => s + lineSum(l.qty, l.price), 0) * 100) / 100;
  const debt = foreign ? (rate ? convertAmount(total, shopCurrency, debtCurrency, Number(rate)) : 0) : total;
  const overLimit = customer && !purchase ? creditLimitExceeded(customer.balance ?? 0, customer.credit_limit, debt, paidNow) : null;

  const trimmed = query.trim();
  const inCart = new Set(lines.map((l) => l.product.id));
  const results = searchProducts(trimmed, products, trimmed ? 8 : 5);

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
    } else {
      const key = ++lineKey.current;
      setLines((all) => [...all, { key, product, qty: "1", price: Number(priceOf(product)) > 0 ? asInput(priceOf(product)) : "" }]);
      setFlash(key);
    }
    setQuery("");
    setCreating(null);
    searchInput.current?.focus();
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
          ? { name: creating.name.trim(), unit: creating.unit, salePrice: "0", purchasePrice: creating.price }
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

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    if (!party) return setLocalError("party");
    if (!lines.length) return setLocalError("lines");
    if (lines.some((l) => !(Number(stockNumber(l.qty, 3)) > 0))) return setLocalError("qty");
    if (lines.some((l) => stockNumber(l.price || "0", 2) === null)) return setLocalError("price");
    // Приход без цены закупки — себестоимость потеряется; просим указать.
    if (purchase && lines.some((l) => !l.price.trim())) return setLocalError("cost");
    if (foreign && !rate) return setLocalError("rate");
    setLocalError(null);
    const form = new FormData(e.currentTarget);
    form.set(
      "lines",
      JSON.stringify(lines.map((l) => ({ product: l.product.id, qty: stockNumber(l.qty, 3), price: stockNumber(l.price || "0", 2) }))),
    );
    if (foreign && rate) form.set("fx_rate", rate);
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
    <form onSubmit={submit} className="simple-operation-form sale-items-form">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <PartyPicker
        label={purchase ? "Поставщик" : "Клиент"}
        name={purchase ? "supplier_id" : "customer_id"}
        parties={allCustomers}
        value={party}
        onChange={(id) => {
          setParty(id);
          if (id) setNewCustomer(false);
        }}
        shopCurrency={shopCurrency}
        actions={
          purchase
            ? undefined
            : (close) => (
                <>
                  <button
                    type="button"
                    className="party-picker-action"
                    onClick={() => {
                      close();
                      setNewCustomer(true);
                    }}
                  >
                    + Новый клиент
                  </button>
                  <ContactPicker
                    className="party-picker-action"
                    label="+ Клиент из контактов"
                    onPick={async ({ name, phone }) => {
                      setContactNote("Ищем клиента…");
                      const found = await customerFromContact(name, phone);
                      if ("error" in found) {
                        setContactNote(
                          found.error === "name" ? "У контакта нет имени — добавьте клиента вручную." : "Не удалось добавить клиента. Попробуйте ещё раз.",
                        );
                        return;
                      }
                      setContactCustomers((list) =>
                        list.some((c) => c.id === found.id) ? list : [...list, { id: found.id, name: found.name, balance: found.balance }],
                      );
                      setParty(found.id);
                      setNewCustomer(false);
                      setContactNote(found.created ? `Добавили нового клиента: ${found.name}.` : `Уже есть в списке: ${found.name}.`);
                    }}
                  />
                </>
              )
        }
      />
      {!purchase && newCustomer && (
        <NewCustomerInline
          customers={allCustomers}
          onClose={() => setNewCustomer(false)}
          onPickExisting={(id) => {
            setParty(id);
            setNewCustomer(false);
          }}
          onCreated={(created) => {
            setContactCustomers((list) => [...list, created]);
            setParty(created.id);
            setNewCustomer(false);
            setContactNote(`Добавили нового клиента: ${created.name}.`);
          }}
        />
      )}
      {!purchase && contactNote && <small className="muted contact-note">{contactNote}</small>}

      <div className="product-picker">
        <label htmlFor="product-search" className="product-picker-title">
          Товары
        </label>
        <input
          id="product-search"
          ref={searchInput}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Найти: название или код"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCreating(null);
          }}
          onKeyDown={(e) => {
            // Enter в поиске добавляет первый найденный, а не отправляет форму.
            if (e.key === "Enter") {
              e.preventDefault();
              if (trimmed && results[0]) add(results[0]);
            }
          }}
        />
        {!trimmed && results.length > 0 && <span className="product-picker-hint muted">Частые:</span>}
        {(results.length > 0 || trimmed) && (
          <ul className={trimmed ? "product-results" : "product-results product-chips"}>
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className={inCart.has(p.id) ? "in-cart" : ""} onClick={() => add(p)}>
                  <span className="product-result-name">{p.name}</span>
                  {trimmed && (
                    <small className="muted">
                      {p.sku ? `${p.sku} · ` : ""}
                      {Number(priceOf(p)) > 0 ? `${purchase ? "закупка " : ""}${money(priceOf(p), shopCurrency)} · ` : ""}есть {quantity(p.stock)} {p.unit}
                    </small>
                  )}
                </button>
              </li>
            ))}
            {trimmed && !creating && (
              <li>
                <button
                  type="button"
                  className="product-new"
                  onClick={() => {
                    setCreating({ name: trimmed, unit: "шт", price: "" });
                    setCreateError(null);
                  }}
                >
                  + Новый товар «{trimmed}»
                </button>
              </li>
            )}
          </ul>
        )}
        {products.length === 0 && !trimmed && (
          <small className="muted">На складе пока нет товаров — начните вводить название, добавим новый.</small>
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
                {purchase ? "Цена закупки" : "Цена"}, {CURRENCY_SIGN[shopCurrency]}
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
      </div>

      {lines.length > 0 && (
        <ol className="sale-lines">
          {lines.map((line, i) => {
            const qtyNum = Number(stockNumber(line.qty, 3) ?? 0);
            const short = !purchase && qtyNum > Number(line.product.stock);
            return (
              <li key={line.key} className={flash === line.key ? "sale-line flash" : "sale-line"}>
                <div className="sale-line-head">
                  <span className="sale-line-n">{i + 1}.</span>
                  <strong>{line.product.name}</strong>
                  <button
                    type="button"
                    className="sale-line-remove"
                    aria-label={`Убрать ${line.product.name}`}
                    onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                  >
                    ×
                  </button>
                </div>
                <div className="sale-line-body">
                  <span className="qty-stepper">
                    <button type="button" aria-label="Меньше" onClick={() => step(line, -1)}>
                      −
                    </button>
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`Количество, ${line.product.unit}`}
                      value={line.qty}
                      onChange={(e) => update(line.key, { qty: e.target.value })}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button type="button" aria-label="Больше" onClick={() => step(line, 1)}>
                      +
                    </button>
                  </span>
                  <span className="sale-line-unit">{line.product.unit} ×</span>
                  <input
                    className="sale-line-price"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`Цена за ${line.product.unit}, ${CURRENCY_SIGN[shopCurrency]}`}
                    value={line.price}
                    onChange={(e) => update(line.key, { price: e.target.value })}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <span className="sale-line-sum">= {money(lineSum(line.qty, line.price).toFixed(2), shopCurrency)}</span>
                </div>
                {short && (
                  <small className="warning">
                    На складе {quantity(line.product.stock)} {line.product.unit} — продать можно, остаток уйдёт в минус.
                  </small>
                )}
                {line.price && Number(priceOf(line.product)) > 0 && stockNumber(line.price, 2) !== null && Number(stockNumber(line.price, 2)) !== Number(priceOf(line.product)) && (
                  <small className="muted">
                    {purchase ? "Прошлая закупка" : "Цена на складе"} — {money(priceOf(line.product), shopCurrency)}.
                  </small>
                )}
                {purchase && !line.price && <small className="muted">Укажите цену закупки за {line.product.unit}.</small>}
              </li>
            );
          })}
        </ol>
      )}

      <div className="sale-total">
        <span>Итого{lines.length ? ` · ${lines.length} ${lines.length === 1 ? "товар" : lines.length < 5 ? "товара" : "товаров"}` : ""}</span>
        <strong>{money(total.toFixed(2), shopCurrency)}</strong>
      </div>
      {foreign && (
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
              {quote ? `${quote.source} на ${quote.date}: ${formatRate(quote.rate)}. Можно поправить.` : "Официальный курс сейчас недоступен — введите курс."}
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
      {overLimit && (
        <p className="form-error limit-warning" role="alert">
          Долг станет {money(overLimit.debtAfter, debtCurrency)} — больше лимита {money(overLimit.limit, debtCurrency)}. Продать
          можно, но проверьте, стоит ли давать в долг.
        </p>
      )}
      {errorText && !saving && (
        <p className="form-error" role="alert" ref={errorRef}>
          {errorText}
        </p>
      )}
      <div className="simple-operation-actions">
        <Submit pending={saving} disabled={!lines.length}>
          {lines.length ? `Записать ${purchase ? "товар" : "продажу"} · ${money(total.toFixed(2), shopCurrency)}` : "Добавьте товары"}
        </Submit>
      </div>
      <p className="operation-hint">
        {purchase
          ? "Остаток на складе вырастет, цена закупки запомнится у товара, сумма добавится к долгу поставщику."
          : "Остаток на складе уменьшится, сумма добавится к долгу клиента. Клиенту можно сразу отправить накладную PDF."}
      </p>
    </form>
  );
}
