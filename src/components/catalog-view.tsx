"use client";

import { useEffect, useMemo, useState } from "react";
import { searchProducts } from "@/lib/match";
import { money } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";

export type CatalogItem = { id: string; name: string; unit: string; price: string };

/** Сколько товаров показывать сразу; дальше — «Показать ещё» (телефону тяжело рисовать тысячи строк). */
const PAGE = 60;

const waHref = (phone: string, text: string) =>
  `https://wa.me/${normalizePhone(phone).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

/** «3», «2,5» → число; пусто и мусор — 0. */
const qtyNumber = (value: string) => {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
};
const qtyText = (n: number) => String(n).replace(".", ",");

/**
 * Каталог магазина для его клиентов (просьба пользователя 22.10.2026):
 * поиск, цены, и «Мой список» — отмеченные товары одной кнопкой уходят
 * магазину сообщением в WhatsApp. Ничего не записывается в базу: список
 * живёт в браузере клиента.
 */
export function CatalogView({
  token,
  shopName,
  shopPhone,
  currency,
  products,
}: {
  token: string;
  shopName: string;
  shopPhone: string;
  currency: string;
  products: CatalogItem[];
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  // Мой список: id товара → количество (как ввели, «2,5»).
  const [list, setList] = useState<Record<string, string>>({});
  const [listOpen, setListOpen] = useState(false);
  // Список уже прочитан из браузера — до этого не сохраняем (иначе пустой
  // начальный список затрёт сохранённый).
  const [loaded, setLoaded] = useState(false);
  const storageKey = `catalog-list-${token}`;

  // Список переживает перезагрузку страницы (только в этом браузере).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, string>;
      const known = new Set(products.map((p) => p.id));
      setList(Object.fromEntries(Object.entries(saved).filter(([id, q]) => known.has(id) && typeof q === "string")));
    } catch {
      // Нет доступа к хранилищу — список просто не запомнится.
    }
    setLoaded(true);
  }, [storageKey, products]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(list));
    } catch {
      // Приватный режим и т.п. — не страшно.
    }
  }, [storageKey, list, loaded]);

  const trimmed = query.trim();
  const found = useMemo(() => (trimmed ? searchProducts(trimmed, products, 200) : products), [trimmed, products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const picked = Object.entries(list)
    .map(([id, qty]) => ({ product: byId.get(id), qty: qtyNumber(qty) }))
    .filter((x): x is { product: CatalogItem; qty: number } => Boolean(x.product) && x.qty > 0);
  const total = picked.reduce((sum, x) => sum + Math.round(x.qty * Number(x.product.price) * 100) / 100, 0);
  const price = (value: string | number) => money(typeof value === "number" ? value.toFixed(2) : value, currency);

  function setQty(id: string, value: string) {
    setList((current) => {
      const next = { ...current };
      if (value === "" || value === "0") delete next[id];
      else next[id] = value;
      return next;
    });
  }
  function step(id: string, delta: number) {
    const next = Math.max(0, Math.round((qtyNumber(list[id] ?? "0") + delta) * 1000) / 1000);
    setQty(id, next ? qtyText(next) : "");
  }

  const message = [
    `Здравствуйте! Хочу заказать (из каталога ${shopName}):`,
    ...picked.map(
      (x, i) =>
        `${i + 1}. ${x.product.name} - ${qtyText(x.qty)} ${x.product.unit} × ${price(x.product.price)} = ${price(
          Math.round(x.qty * Number(x.product.price) * 100) / 100,
        )}`,
    ),
    `Итого: ${price(total)}`,
  ].join("\n");

  return (
    <>
      <div className="catalog-search">
        <label htmlFor="catalog-search" className="sr-only">
          Найти товар
        </label>
        <input
          id="catalog-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Найти товар"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
        />
      </div>

      {found.length === 0 ? (
        <section className="catalog-empty">
          <p>
            {trimmed ? `По запросу «${trimmed}» ничего не нашли.` : "В каталоге пока нет товаров."}
          </p>
          {shopPhone && (
            <a
              className="button"
              href={waHref(shopPhone, trimmed ? `Здравствуйте! Есть ли у вас «${trimmed}»?` : "Здравствуйте! Подскажите, пожалуйста, что есть в наличии?")}
              target="_blank"
              rel="noopener noreferrer"
            >
              Спросить в WhatsApp
            </a>
          )}
        </section>
      ) : (
        <ul className="catalog-list">
          {found.slice(0, shown).map((p) => {
            const qty = list[p.id];
            return (
              <li key={p.id} className={qty ? "catalog-item in-list" : "catalog-item"}>
                <span className="catalog-item-text">
                  <span className="catalog-item-name">{p.name}</span>
                  <span className="catalog-item-price">
                    {price(p.price)} <small>за {p.unit}</small>
                  </span>
                </span>
                {qty ? (
                  <span className="catalog-qty" role="group" aria-label={`Сколько: ${p.name}`}>
                    <button type="button" aria-label="Меньше" onClick={() => step(p.id, -1)}>
                      −
                    </button>
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`Количество, ${p.unit}`}
                      value={qty}
                      onChange={(e) => setQty(p.id, e.target.value.replace(/[^\d.,]/g, "").slice(0, 8))}
                    />
                    <button type="button" aria-label="Больше" onClick={() => step(p.id, 1)}>
                      +
                    </button>
                  </span>
                ) : (
                  <button type="button" className="catalog-add" onClick={() => setQty(p.id, "1")} aria-label={`В список: ${p.name}`}>
                    + В список
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {found.length > shown && (
        <button type="button" className="button catalog-more" onClick={() => setShown((n) => n + PAGE)}>
          Показать ещё ({found.length - shown})
        </button>
      )}

      <p className="catalog-note muted">Цены могут меняться - точную сумму подтвердит продавец.</p>

      {picked.length > 0 && (
        <div className="catalog-bar">
          {listOpen && (
            <div className="catalog-bar-list">
              <ol>
                {picked.map((x) => (
                  <li key={x.product.id}>
                    <span>
                      {x.product.name}
                      <small className="muted">
                        {" "}
                        · {qtyText(x.qty)} {x.product.unit}
                      </small>
                    </span>
                    <strong>{price(Math.round(x.qty * Number(x.product.price) * 100) / 100)}</strong>
                    <button type="button" className="catalog-bar-remove" aria-label={`Убрать: ${x.product.name}`} onClick={() => setQty(x.product.id, "")}>
                      ×
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" className="text-button" onClick={() => { setList({}); setListOpen(false); }}>
                Очистить список
              </button>
            </div>
          )}
          <div className="catalog-bar-main">
            <button type="button" className="catalog-bar-summary" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
              <small>
                Мой список: {picked.length} {listOpen ? "▴" : "▾"}
              </small>
              <strong>{price(total)}</strong>
            </button>
            {shopPhone && (
              <a className="button primary catalog-send" href={waHref(shopPhone, message)} target="_blank" rel="noopener noreferrer">
                Отправить в WhatsApp
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
