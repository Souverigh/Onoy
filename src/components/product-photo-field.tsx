"use client";

import { useState } from "react";
import {
  PRODUCT_PHOTO_ACCEPT,
  PRODUCT_PHOTO_ERROR as ERROR_TEXT,
  removeProductPhoto,
  uploadProductPhoto,
} from "@/lib/product-photo-upload";
import type { ProductPhotoResult } from "@/app/(workspace)/stock/photo-actions";

/**
 * Фото товара для каталога клиентов: одна кнопка — на телефоне система
 * предложит камеру или галерею. Фото ужимается в браузере и сразу сохраняется.
 */
export function ProductPhotoField({ productId, name, initialUrl }: { productId: string; name: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_TEXT | null>(null);

  async function run(task: () => Promise<ProductPhotoResult>) {
    setBusy(true);
    setError(null);
    const result = await task();
    if ("error" in result) setError(result.error);
    else setUrl(result.url);
    setBusy(false);
  }

  async function pick(file: File | null) {
    if (file) await run(() => uploadProductPhoto(productId, file));
  }

  return (
    <div className="product-photo">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="product-photo-img" src={url} alt={name} />
      ) : (
        <span className="product-photo-empty" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <div className="product-photo-actions">
        <strong>Фото для каталога</strong>
        <small className="muted">Клиенты видят его в каталоге рядом с ценой.</small>
        <div className="product-photo-buttons">
          {busy ? (
            <span className="button disabled">Сохраняем…</span>
          ) : (
            <label className={url ? "button" : "button primary"}>
              {url ? "Заменить фото" : "Добавить фото"}
              <input
                type="file"
                accept={PRODUCT_PHOTO_ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void pick(file);
                }}
              />
            </label>
          )}
          {url && !busy && (
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => void run(() => removeProductPhoto(productId))}
            >
              Убрать фото
            </button>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {ERROR_TEXT[error]}
          </p>
        )}
      </div>
    </div>
  );
}
