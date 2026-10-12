/**
 * Клиенты из контактов телефона (ТЗ §4 Б). Номер приводим к +996… / +7…,
 * чтобы «0555 12-34-56», «+996 555 123 456» и «996555123456» (или «8 916…» и
 * «+7 916…») были одним клиентом.
 * Выбор из списка контактов (Contact Picker API) есть только в Chrome на Android.
 */
export type PickedContact = { name: string; phone: string };

/**
 * Номер телефона в международном виде «+996…» / «+7…», как бы его ни
 * записали:
 *   Кыргызстан — +996 555 123 456, 996555123456, 0555 12-34-56, 555123456
 *                и частая ошибка «+996 0555…» (лишний 0 после кода);
 *   Россия     — +7 916 123-45-67, 8 (916) 123-45-67, 9161234567;
 *   «00» в начале — международный префикс (00996…, 007…).
 * Остальное — «+» и цифры как есть; без цифр — "".
 */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Кыргызстан
  if (digits.length === 13 && digits.startsWith("9960")) return `+996${digits.slice(4)}`;
  if (digits.length === 12 && digits.startsWith("996")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+996${digits.slice(1)}`;
  if (digits.length === 9) return `+996${digits}`;
  // Россия (и Казахстан — тоже +7)
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`;
  return `+${digits}`;
}

/** Ключ для сравнения номеров: цифры номера в международном виде. */
export function phoneKey(raw: string | null | undefined): string {
  return normalizePhone(String(raw ?? "")).replace(/\D/g, "");
}

/**
 * Номер для хранения: похожий на телефон (10–15 цифр после нормализации) —
 * в международном виде, иначе как ввели (добавочный, «нет» и т.п.).
 */
export function storedPhone(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  const normalized = normalizePhone(text);
  const digits = normalized.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 15 ? normalized : text;
}
