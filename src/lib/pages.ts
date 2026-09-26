/** Больше страниц в одной накладной не принимаем — ни форма, ни сервер. */
export const MAX_PAGES = 5;

/** Документ — фото или PDF (накладная поставщика, чек MBank из приложения банка). */
export const DOCUMENT_ACCEPT = "image/*,application/pdf";

export function isPdf(file: { type: string; name?: string }) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
}

/** Запас под лимит тела server action (4 МБ, next.config.ts): фото ужимаются, PDF — нет. */
export const MAX_UPLOAD_BYTES = 3.8 * 1024 * 1024;
