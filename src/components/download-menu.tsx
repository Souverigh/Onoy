import { Icon } from "./icon";

/**
 * «Скачать» отчёт: Excel или PDF за тот же период, что на экране. `href` —
 * адрес выгрузки без формата (`/reports/export?period=month`).
 */
export function DownloadMenu({
  href,
  pdfHref,
  label,
}: {
  href: string;
  /** Свой адрес PDF (итог дня — /day/pdf). */
  pdfHref?: string;
  /** Подпись рядом с иконкой на компьютере («Скачать»); на телефоне — только иконка. */
  label?: string;
}) {
  const withFormat = (format: "xlsx" | "pdf") =>
    format === "pdf" && pdfHref ? pdfHref : `${href}${href.includes("?") ? "&" : "?"}format=${format}`;
  return (
    <details className="more-menu download-menu">
      <summary
        className={`day-nav-arrow download-toggle${label ? " with-label" : ""}`}
        aria-label="Скачать отчёт"
        title="Скачать отчёт"
      >
        <Icon name="download" />
        {label && <span className="download-label">{label}</span>}
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
