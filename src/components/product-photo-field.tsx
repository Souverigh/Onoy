"use client";

import { useState } from "react";
import { shrinkImage } from "@/lib/shrink-image";
import { PRODUCT_PHOTO_MAX_BYTES, PRODUCT_PHOTO_SIDE, PRODUCT_PHOTO_TYPES, PRODUCT_THUMB_SIDE } from "@/lib/product-photo";
import { setProductPhoto } from "@/app/(workspace)/stock/photo-actions";

const ERROR_TEXT = {
  type: "Этот формат фото не подходит. Сфотографируйте заново или выберите JPG / PNG.",
  size: "Фото слишком большое. Выберите другое.",
  save: "Не удалось сохранить фото. Проверьте интернет и попробуйте ещё раз.",
};

/**
 * Фото товара для каталога клиентов: одна кнопка — телефон сам предложит
 * камеру или галерею (без capture, как у фото накладной). Фото ужимается в
 * браузере и сразу сохраняется.
 */
export function ProductPhotoField({ productId, name, initialUrl }: { productId: string; name: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof ERROR_TEXT | null>(null);

  async function send(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const result = await setProductPhoto(form);
      if ("error" in result) setError(result.error);
      else setUrl(result.url);
    } catch {
      setError("save");
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | null) {
    if (!file) return;
    const [shrunk, thumb] = await Promise.all([
      shrinkImage(file, PRODUCT_PHOTO_SIDE),
      // Миниатюра для списков каталога: ~10 КБ, клиенту — меньше трафика.
      shrinkImage(file, PRODUCT_THUMB_SIDE),
    ]);
    if (!PRODUCT_PHOTO_TYPES.includes(shrunk.type)) return setError("type");
    if (shrunk.size > PRODUCT_PHOTO_MAX_BYTES) return setError("size");
    const form = new FormData();
    form.set("product_id", productId);
    form.set("photo", shrunk);
    if (thumb.type === "image/jpeg" && thumb.size < shrunk.size) form.set("thumb", thumb);
    await send(form);
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
          <label className={`button${busy ? " disabled" : ""}`}>
            {busy ? "Сохраняем…" : url ? "Заменить фото" : "Сфотографировать или выбрать"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                void pick(file);
              }}
            />
          </label>
          {url && !busy && (
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => {
                const form = new FormData();
                form.set("product_id", productId);
                form.set("remove", "1");
                void send(form);
              }}
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
