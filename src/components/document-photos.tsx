"use client";

import { useState } from "react";

/** Фото документа; у многостраничной накладной — переключатель «Стр. 1 · 2 · 3». */
export function DocumentPhotos({ urls }: { urls: (string | null)[] }) {
  const [current, setCurrent] = useState(0);
  const url = urls[current];
  return (
    <>
      {urls.length > 1 && (
        <div className="page-switcher" role="tablist" aria-label="Страницы документа">
          <span className="muted">Стр.</span>
          {urls.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === current}
              className={i === current ? "page-switch active" : "page-switch"}
              onClick={() => setCurrent(i)}
            >
              {i + 1}
            </button>
          ))}
          <span className="muted page-switcher-total">из {urls.length}</span>
        </div>
      )}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={urls.length > 1 ? `Страница ${current + 1}` : "Фото документа"}
          className="document-photo"
        />
      ) : (
        <p className="muted">Фото недоступно.</p>
      )}
    </>
  );
}
