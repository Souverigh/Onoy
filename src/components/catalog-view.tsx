"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchProducts } from "@/lib/match";
import { money } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";
import { categoryTree, categoryWithChildren, type Category } from "@/lib/category";
import { ClientPromo } from "./client-promo";

/** photo — адрес фото товара, thumb — его миниатюры (публичное хранилище) или null. */
export type CatalogItem = {
  id: string;
  name: string;
  unit: string;
  price: string;
  photo: string | null;
  thumb: string | null;
  /** Категория товара; null — без категории («Другое»). */
  category: string | null;
};

/** Отбор «Другое» — товары без категории. */
const OTHER = "other";

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
  categories,
}: {
  token: string;
  shopName: string;
  shopPhone: string;
  currency: string;
  products: CatalogItem[];
  categories: Category[];
}) {
  const [query, setQuery] = useState("");
  // Категория и подкатегория (просьба пользователя 23.10.2026); null — все товары.
  const [top, setTop] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  // Список товаров: на компьютере прокручивается внутри рамки; конец списка
  // виден — показываем следующие (без кнопки «Показать ещё»).
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // Мой список: id товара → количество (как ввели, «2,5»).
  const [list, setList] = useState<Record<string, string>>({});
  const [listOpen, setListOpen] = useState(false);
  // Очищенный список — несколько секунд можно вернуть («Вернуть»).
  const [cleared, setCleared] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(null), 6000);
    return () => clearTimeout(timer);
  }, [cleared]);
  // Фото товара крупно (нажали на миниатюру).
  const [zoom, setZoom] = useState<CatalogItem | null>(null);
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
  const tree = useMemo(() => categoryTree(categories), [categories]);
  const hasOther = tree.length > 0 && products.some((p) => !p.category);
  const inCategory = useMemo(() => {
    if (!top) return products;
    if (top === OTHER) return products.filter((p) => !p.category);
    const ids = new Set(sub ? [sub] : categoryWithChildren(categories, top));
    return products.filter((p) => p.category && ids.has(p.category));
  }, [top, sub, products, categories]);
  const found = useMemo(() => (trimmed ? searchProducts(trimmed, inCategory, 200) : inCategory), [trimmed, inCategory]);
  const more = found.length > shown;
  useEffect(() => {
    const target = end.current;
    if (!more || !target || typeof IntersectionObserver === "undefined") return;
    // Компьютер — своя прокрутка у списка; телефон — вся страница.
    const box = scroller.current;
    const root = box && box.scrollHeight > box.clientHeight + 1 ? box : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      { root, rootMargin: "400px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, shown]);
  // Другой отбор или поиск — список снова с начала.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [trimmed, top, sub]);
  // Сколько товаров в категории (с подкатегориями) — числом в списке.
  const counts = useMemo(() => {
    const own = new Map<string, number>();
    for (const p of products) if (p.category) own.set(p.category, (own.get(p.category) ?? 0) + 1);
    return own;
  }, [products]);
  const topCount = (id: string) =>
    (counts.get(id) ?? 0) + categories.filter((c) => c.parent_id === id).reduce((s, c) => s + (counts.get(c.id) ?? 0), 0);
  const otherCount = products.filter((p) => !p.category).length;
  // Телефон: список категорий раскрывается кнопкой.
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const pickTop = (id: string | null) => {
    setTop(id);
    setSub(null);
    setShown(PAGE);
  };
  const pickSub = (id: string | null) => {
    setSub(id);
    setShown(PAGE);
    setCategoriesOpen(false);
  };
  const currentName =
    top === OTHER
      ? "Другое"
      : top
        ? [tree.find((x) => x.category.id === top)?.category.name, sub ? categories.find((c) => c.id === sub)?.name : null]
            .filter(Boolean)
            .join(" / ")
        : "Все товары";

  /** Категории списком: выбранная раскрывает свои подкатегории. */
  const categoryList = (
    <ul className="catalog-category-list">
      <li>
        <button
          type="button"
          aria-pressed={!top}
          className={!top ? "active" : undefined}
          onClick={() => {
            pickTop(null);
            setCategoriesOpen(false);
          }}
        >
          <span>Все товары</span>
          <small>{products.length}</small>
        </button>
      </li>
      {tree.map(({ category, children: subs }) => (
        <li key={category.id}>
          <button
            type="button"
            aria-pressed={top === category.id && !sub}
            className={top === category.id ? (sub ? "open" : "active") : undefined}
            onClick={() => {
              pickTop(category.id);
              // Без подкатегорий выбирать дальше нечего — список закрывается.
              if (!subs.length) setCategoriesOpen(false);
            }}
          >
            <span>{category.name}</span>
            <small>{topCount(category.id)}</small>
          </button>
          {top === category.id && subs.length > 0 && (
            <ul>
              {subs.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={sub === c.id}
                    className={sub === c.id ? "active" : undefined}
                    onClick={() => pickSub(c.id)}
                  >
                    <span>{c.name}</span>
                    <small>{counts.get(c.id) ?? 0}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      {hasOther && (
        <li>
          <button
            type="button"
            aria-pressed={top === OTHER}
            className={top === OTHER ? "active" : undefined}
            onClick={() => {
              pickTop(OTHER);
              setCategoriesOpen(false);
            }}
          >
            <span>Другое</span>
            <small>{otherCount}</small>
          </button>
        </li>
      )}
    </ul>
  );
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

  /** «Очистить» — весь список сразу; случайно нажали — «Вернуть». */
  function clearList() {
    setCleared(list);
    setList({});
    setListOpen(false);
  }
  const clearButton = (
    <button type="button" className="text-button catalog-clear" onClick={clearList}>
      Очистить
    </button>
  );
  const undoClear = cleared && Object.keys(cleared).length > 0 && (
    <p className="catalog-cleared" role="status">
      Список очищен ·{" "}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setList(cleared);
          setCleared(null);
        }}
      >
        Вернуть
      </button>
    </p>
  );

  const pickedList = (
    <ol className="catalog-picked">
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
  );
  const sendButton = shopPhone ? (
    <a className="button primary catalog-send" href={waHref(shopPhone, message)} target="_blank" rel="noopener noreferrer">
      Отправить в WhatsApp
    </a>
  ) : null;

  return (
    <>
      {/* Компьютер: каталог слева, «Мой список» справа (закреплён); телефон — колонкой. */}
      <div className={tree.length ? "catalog-layout with-categories" : "catalog-layout"}>
      {/* Компьютер: категории колонкой слева. */}
      {tree.length > 0 && (
        <nav className="catalog-categories-side" aria-label="Категории">
          <h2>Категории</h2>
          {categoryList}
        </nav>
      )}
      <div className="catalog-main">
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

      {tree.length > 0 && (
        <div className="catalog-categories-phone">
          <button
            type="button"
            className="catalog-categories-toggle"
            aria-expanded={categoriesOpen}
            onClick={() => setCategoriesOpen((o) => !o)}
          >
            <span>
              <small>Категория</small>
              {currentName}
            </span>
            <span aria-hidden="true">{categoriesOpen ? "▴" : "▾"}</span>
          </button>
          {categoriesOpen && categoryList}
        </div>
      )}

      {found.length === 0 ? (
        <section className="catalog-empty">
          <p>
            {trimmed
              ? `По запросу «${trimmed}» ничего не нашли${top ? " в этой категории" : ""}.`
              : top
                ? "В этой категории пока нет товаров."
                : "В каталоге пока нет товаров."}
          </p>
          {top && (
            <button type="button" className="button" onClick={() => pickTop(null)}>
              Искать во всех товарах
            </button>
          )}
          {shopPhone && (
            <a
              className="button"
              href={waHref(
                shopPhone,
                trimmed ? `Здравствуйте! Есть ли у вас «${trimmed}»? (фото ниже, если есть)` : "Здравствуйте! Подскажите, пожалуйста, что есть в наличии?",
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Спросить или отправить фото в WhatsApp
            </a>
          )}
        </section>
      ) : (
        <div className="catalog-scroll" ref={scroller}>
        <ul className="catalog-list">
          {found.slice(0, shown).map((p) => {
            const qty = list[p.id];
            return (
              <li key={p.id} className={qty ? "catalog-item in-list" : "catalog-item"}>
                {p.photo ? (
                  <button type="button" className="catalog-thumb" onClick={() => setZoom(p)} aria-label={`Фото: ${p.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.thumb ?? p.photo}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={56}
                      height={56}
                      // Миниатюры нет (фото загрузили до неё) — полное фото.
                      onError={(e) => {
                        if (p.photo && e.currentTarget.src !== p.photo) e.currentTarget.src = p.photo;
                      }}
                    />
                  </button>
                ) : (
                  <span className="catalog-thumb catalog-thumb-empty" aria-hidden="true">
                    {p.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
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
        {more && (
          <div ref={end} className="catalog-more-end">
            {/* Запасной путь, если подгрузка при прокрутке не сработала. */}
            <button type="button" className="button catalog-more" onClick={() => setShown((n) => n + PAGE)}>
              Показать ещё ({found.length - shown})
            </button>
          </div>
        )}
        </div>
      )}

      {shopPhone && found.length > 0 && (
        <div className="catalog-ask">
          <span>
            <strong>Не нашли нужное?</strong>
            <small className="muted">Отправьте фото или название товара - подскажем, есть ли он.</small>
          </span>
          <a
            className="button"
            href={waHref(shopPhone, "Здравствуйте! Ищу такой товар (фото ниже). Есть у вас?")}
            target="_blank"
            rel="noopener noreferrer"
          >
            Отправить фото
          </a>
        </div>
      )}

      <p className="catalog-note muted">Цены могут меняться - точную сумму подтвердит продавец.</p>
      </div>

      <aside className="catalog-aside" aria-label="Мой список">
        <div className="catalog-aside-head">
          <h2>Мой список{picked.length ? ` · ${picked.length}` : ""}</h2>
          {picked.length > 0 && clearButton}
        </div>
        {picked.length ? (
          <>
            {pickedList}
            <div className="catalog-aside-total">
              <span className="muted">Итого</span>
              <strong>{price(total)}</strong>
            </div>
            {sendButton}
          </>
        ) : (
          <>
            {undoClear || (
              <p className="muted">
                Нажмите «+ В список» у нужных товаров - список с суммой уйдёт магазину одним сообщением в WhatsApp.
              </p>
            )}
          </>
        )}
      </aside>
      </div>

      {zoom?.photo && (
        <div className="catalog-zoom" role="dialog" aria-modal="true" aria-label={zoom.name} onClick={() => setZoom(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.photo} alt={zoom.name} />
            <figcaption>
              <span>{zoom.name}</span>
              <strong>
                {price(zoom.price)} <small>за {zoom.unit}</small>
              </strong>
            </figcaption>
            <div className="catalog-zoom-actions">
              {!list[zoom.id] && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    setQty(zoom.id, "1");
                    setZoom(null);
                  }}
                >
                  + В список
                </button>
              )}
              <button type="button" className="button" onClick={() => setZoom(null)}>
                Закрыть
              </button>
            </div>
          </figure>
        </div>
      )}

      {picked.length > 0 && (
        <div className="catalog-bar">
          {listOpen && <div className="catalog-bar-list">{pickedList}</div>}
          <div className="catalog-bar-main">
            <button type="button" className="catalog-bar-summary" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
              <small>
                Мой список: {picked.length} {listOpen ? "▴" : "▾"}
              </small>
              <strong>{price(total)}</strong>
            </button>
            {clearButton}
            {sendButton}
          </div>
        </div>
      )}
      {/* Depter: свой каталог для магазина; подсказка сама на пару секунд (просьба пользователя 23.10.2026). */}
      <ClientPromo
        hint
        raised={picked.length > 0 || Boolean(undoClear)}
        label="Depter: такой же каталог для вашего магазина"
        text="Хотите такой же каталог с ценами для своего магазина? Клиенты выбирают товары и присылают список в WhatsApp. Напишите нам - поможем."
      />
      {/* Телефон: после «Очистить» панели нет — «Вернуть» на её месте. */}
      {picked.length === 0 && undoClear && <div className="catalog-bar catalog-bar-undo">{undoClear}</div>}
    </>
  );
}
