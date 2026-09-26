/** Больше страниц в одной накладной не принимаем — ни форма, ни сервер. */
export const MAX_PAGES = 5;

/**
 * Документ — фото или PDF (накладная поставщика, чек MBank из приложения банка).
 * Форматы перечислены явно, без «image/*»: увидев «image/*», телефон (Android)
 * открывает камеру или галерею, и PDF из Загрузок/WhatsApp не выбрать. С явным
 * списком открывается обычный выбор файлов, где есть и галерея, и папки.
 */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
export const DOCUMENT_ACCEPT = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".pdf",
  ...IMAGE_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

export function isPdf(file: { type: string; name?: string }) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
}

/** MIME-тип документа; если телефон его не указал — по расширению файла. */
export function documentMimeType(file: { type: string; name?: string }) {
  if (isPdf(file)) return "application/pdf";
  if (file.type) return file.type;
  const ext = (file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return `image/${ext}`;
  return "image/jpeg";
}

/** Фото или PDF — по типу, а если телефон тип не указал (бывает у HEIC) — по расширению. */
export function isAcceptedDocument(file: { type: string; name?: string }) {
  if (file.type.startsWith("image/") || isPdf(file)) return true;
  const ext = (file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Запас под лимит тела server action (4 МБ, next.config.ts): фото ужимаются, PDF — нет. */
export const MAX_UPLOAD_BYTES = 3.8 * 1024 * 1024;
