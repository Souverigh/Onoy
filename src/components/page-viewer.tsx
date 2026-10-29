"use client";

import { useEffect, useRef, useState } from "react";

export type ViewerPage = {
  key: string;
  pdf: boolean;
  /** Адрес фото или PDF; нет — только значок. */
  url: string | null;
  /** «№ 15», «Лист 2», «Файл 3». */
  title: string;
  /** Сумма накладной или имя файла. */
  note?: string;
};

/**
 * Листы и файлы накладной (просьба пользователя 28.10.2026: две накладные
 * рядом разъезжались в ширину). Сверху — вкладки: миниатюра, номер и сумма;
 * под ними один крупный просмотр выбранного, внизу — «‹ › 2 из 3». На
 * компьютере PDF — просмотром браузера; на телефоне крупно только фото
 * (PDF телефон внутри страницы не показывает — хватает значка на вкладке).
 */
export function PageViewer({ pages, onRemove }: { pages: ViewerPage[]; onRemove?: (index: number) => void }) {
  const [current, setCurrent] = useState(0);
  // Добавили страницу — показываем её.
  const count = pages.length;
  const before = useRef(count);
  useEffect(() => {
    if (count > before.current) setCurrent(count - 1);
    before.current = count;
  }, [count]);
  if (!count) return null;
  const index = Math.min(current, count - 1);
  const page = pages[index];
  const prev = pages[index - 1];
  const next = pages[index + 1];
  return (
    <div className="page-viewer">
      <ol className="page-tabs">
        {pages.map((p, i) => (
          <li key={p.key} className={i === index ? "page-tab on" : "page-tab"}>
            <button type="button" className="page-tab-main" aria-pressed={i === index} onClick={() => setCurrent(i)}>
              <span className="page-tab-mini">
                {p.pdf || !p.url ? (
                  <span>{p.pdf ? "PDF" : "Фото"}</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" />
                )}
              </span>
              <span className="page-tab-text">
                <b>{p.title}</b>
                {p.note && <small>{p.note}</small>}
              </span>
            </button>
            {onRemove && (
              <button type="button" className="page-tab-remove" aria-label={`Убрать: ${p.title}`} onClick={() => onRemove(i)}>
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      {page.url && (
        <div className={page.pdf ? "page-view is-pdf" : "page-view"}>
          {page.pdf ? (
            <iframe key={page.key} src={page.url} title={page.title} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.url} alt={page.title} />
          )}
          {count > 1 && (
            <div className="page-view-nav">
              <button type="button" disabled={!prev} onClick={() => setCurrent(index - 1)} aria-label="Предыдущий">
                ‹ {prev?.title ?? ""}
              </button>
              <span>
                {index + 1} из {count}
              </span>
              <button type="button" disabled={!next} onClick={() => setCurrent(index + 1)} aria-label="Следующий">
                {next?.title ?? ""} ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
