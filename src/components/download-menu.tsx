import { Icon } from "./icon";

/**
 * «Скачать» отчёт: Excel или PDF за тот же период, что на экране. `href` —
 * адрес выгрузки без формата (`/reports/export?period=month`).
 */
export function DownloadMenu({ href }: { href: string }) {
  const withFormat = (format: "xlsx" | "pdf") => `${href}${href.includes("?") ? "&" : "?"}format=${format}`;
  return (
    <details className="more-menu download-menu">
      <summary className="day-nav-arrow download-toggle" aria-label="Скачать отчёт" title="Скачать отчёт">
        <Icon name="download" />
      </summary>
      <div className="more-menu-list">
        <a href={withFormat("xlsx")} download>
          Excel (.xlsx)
          <small className="muted">для бухгалтера и подсчётов</small>
        </a>
        <a href={withFormat("pdf")} download>
          PDF
          <small className="muted">отправить или распечатать</small>
        </a>
      </div>
    </details>
  );
}
