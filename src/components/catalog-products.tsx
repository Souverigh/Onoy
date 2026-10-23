"use client";

import { useMemo, useState } from "react";
import { searchProducts } from "@/lib/match";
import { PRODUCT_PHOTO_ERROR, uploadProductPhoto } from "@/lib/product-photo-upload";
import { money } from "@/lib/format";
import { Submit } from "./submit";
import { saveCatalogProducts } from "@/app/(workspace)/stock/catalog/actions";

export type CatalogProductRow = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sale_price: string;
  catalog_hidden: boolean;
  /** Готовый адрес фото или null. */
  photo: string | null;
};

/**
 * Владелец: какие товары видны клиентам в каталоге. Галочка — показывать;
 * товар без цены продажи в каталог не попадает (галочка недоступна).
 */
export function CatalogProducts({ products, currency }: { products: CatalogProductRow[]; currency: string }) {
  const [hidden, setHidden] = useState(() => new Set(products.filter((p) => p.catalog_hidden).map((p) => p.id)));
  const [query, setQuery] = useState("");
  // «Без фото» — что ещё сфотографировать для каталога.
  const [noPhoto, setNoPhoto] = useState(false);
  // Фото, загруженные прямо из списка: id → миниатюра (до перезагрузки страницы).
  const [uploaded, setUploaded] = useState<Record<string, string | null>>({});
  const [uploading, setUploading] = useState<Set<string>>(() => new Set());
  const [photoError, setPhotoError] = useState<{ id: string; text: string } | null>(null);
  // Телефон: у какого товара открыт выбор «Камера / Галерея».
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const photoOf = (p: CatalogProductRow) => (p.id in uploaded ? uploaded[p.id] : p.photo);
  const initial = useMemo(() => new Set(products.filter((p) => p.catalog_hidden).map((p) => p.id)), [products]);
  const priced = products.filter((p) => Number(p.sale_price) > 0);
  const visible = priced.filter((p) => !hidden.has(p.id)).length;
  const trimmed = query.trim();
  const searched = trimmed ? searchProducts(trimmed, products, 300) : products;
  const rows = noPhoto ? searched.filter((p) => !photoOf(p) || p.id in uploaded) : searched;
  const withoutPhoto = priced.filter((p) => !photoOf(p)).length;
  const changed = hidden.size !== initial.size || [...hidden].some((id) => !initial.has(id));

  /** Фото выбрали — сразу ужать и загрузить; в строке — «…», потом миниатюра. */
  async function upload(id: string, file: File | null) {
    setMenuFor(null);
    if (!file) return;
    setPhotoError(null);
    setUploading((s) => new Set(s).add(id));
    const result = await uploadProductPhoto(id, file);
    setUploading((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if ("error" in result) setPhotoError({ id, text: PRODUCT_PHOTO_ERROR[result.error] });
    else setUploaded((u) => ({ ...u, [id]: result.thumb ?? result.url }));
  }

  /** Поле выбора файла: camera — сразу камера (на Android выбор фото её не предлагает). */
  const fileInput = (id: string, camera = false) => (
    <input
      type="file"
      accept="image/*"
      {...(camera ? { capture: "environment" as const } : {})}
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0] ?? null;
        e.target.value = "";
        void upload(id, file);
      }}
    />
  );

  function toggle(id: string, show: boolean) {
    setHidden((current) => {
      const next = new Set(current);
      if (show) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={saveCatalogProducts} className="catalog-products">
      {/* Только изменённые: скрыть и показать — остальные товары база не трогает. */}
      <input type="hidden" name="hide" value={JSON.stringify([...hidden].filter((id) => !initial.has(id)))} />
      <input type="hidden" name="show" value={JSON.stringify([...initial].filter((id) => !hidden.has(id)))} />
      <div className="section-title">
        <h2>Товары в каталоге</h2>
        <span className="muted">
          видно {visible} из {priced.length}
        </span>
      </div>
      <p className="muted catalog-products-hint">
        Клиенты видят название и цену продажи. Остатки, цены закупки и коды не видны. Товары без цены продажи в
        каталог не попадают.
      </p>
      <div className="catalog-products-tools">
        <input
          type="search"
          placeholder="Найти товар"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Найти товар"
        />
        <label className="catalog-products-filter">
          <input type="checkbox" checked={noPhoto} onChange={(e) => setNoPhoto(e.target.checked)} />
          Без фото ({withoutPhoto})
        </label>
        <button type="button" className="text-button" onClick={() => setHidden(new Set())}>
          Показать все
        </button>
        <button type="button" className="text-button" onClick={() => setHidden(new Set(products.map((p) => p.id)))}>
          Скрыть все
        </button>
      </div>
      <ul className="catalog-products-list">
        {rows.slice(0, 300).map((p) => {
          const noPrice = !(Number(p.sale_price) > 0);
          const photo = photoOf(p);
          const busy = uploading.has(p.id);
          return (
            <li key={p.id} className={noPrice ? "muted" : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={!noPrice && !hidden.has(p.id)}
                  disabled={noPrice}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                />
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="catalog-products-thumb" src={photo} alt="" loading="lazy" />
                ) : (
                  <span className="catalog-products-thumb catalog-products-thumb-empty" aria-hidden="true" />
                )}
                <span className="catalog-products-sku">{p.sku || "-"}</span>
                <span className="catalog-products-name">{p.name}</span>
                <span className="catalog-products-price">
                  {noPrice ? "нет цены" : `${money(p.sale_price, currency)} / ${p.unit}`}
                </span>
              </label>
              {/* Фото — прямо отсюда: компьютер — выбор файла, телефон — «Камера / Галерея». */}
              {busy ? (
                <span className="catalog-products-edit catalog-products-busy" aria-live="polite">
                  Загружаем…
                </span>
              ) : (
                <>
                  <label className="catalog-products-edit catalog-photo-desktop" aria-label={`Фото: ${p.name}`}>
                    {photo ? "Изменить" : "+ Фото"}
                    {fileInput(p.id)}
                  </label>
                  <button
                    type="button"
                    className="catalog-products-edit catalog-photo-touch"
                    aria-expanded={menuFor === p.id}
                    onClick={() => setMenuFor((m) => (m === p.id ? null : p.id))}
                  >
                    {photo ? "Изменить" : "+ Фото"}
                  </button>
                </>
              )}
              {menuFor === p.id && !busy && (
                <div className="catalog-photo-menu">
                  <label className="button primary">
                    Камера
                    {fileInput(p.id, true)}
                  </label>
                  <label className="button">
                    Галерея
                    {fileInput(p.id)}
                  </label>
                  <button type="button" className="text-button" onClick={() => setMenuFor(null)}>
                    Отмена
                  </button>
                </div>
              )}
              {photoError?.id === p.id && (
                <p className="form-error catalog-photo-error" role="alert">
                  {photoError.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > 300 && <p className="muted">Показаны первые 300 - уточните поиск.</p>}
      <div className="catalog-products-save">
        <Submit disabled={!changed}>{changed ? "Сохранить" : "Сохранено"}</Submit>
      </div>
    </form>
  );
}
