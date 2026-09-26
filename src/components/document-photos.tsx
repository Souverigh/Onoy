"use client";

import { useState } from "react";

export type DocumentPageView = { url: string | null; mimeType: string };

/**
 * Страницы документа: фото или PDF. У многостраничной накладной —
 * переключатель «Стр. 1 · 2 · 3»; PDF показывается встроенным просмотром
 * со своей прокруткой (в нём самом может быть несколько страниц).
 */
export function DocumentPhotos({ pages }: { pages: DocumentPageView[] }) {
  const [current, setCurrent] = useState(0);
  const page = pages[current];
  const pdf = page?.mimeType === "application/pdf";
  return (
    <>
      {pages.length > 1 && (
        <div className="page-switcher" role="tablist" aria-label="Страницы документа">
          <span className="muted">Стр.</span>
          {pages.map((p, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === current}
              className={i === current ? "page-switch active" : "page-switch"}
              onClick={() => setCurrent(i)}
            >
              {i + 1}
              {p.mimeType === "application/pdf" ? " PDF" : ""}
            </button>
          ))}
          <span className="muted page-switcher-total">из {pages.length}</span>
        </div>
      )}
      {!page?.url ? (
        <p className="muted">Файл недоступен.</p>
      ) : pdf ? (
        <>
          <iframe src={page.url} title="PDF документа" className="document-pdf" />
          <a className="text-button" href={page.url} target="_blank" rel="noreferrer">
            Открыть PDF отдельно
          </a>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.url}
          alt={pages.length > 1 ? `Страница ${current + 1}` : "Фото документа"}
          className="document-photo"
        />
      )}
    </>
  );
}
