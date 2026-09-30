/**
 * Клиенты из контактов телефона (ТЗ §4 Б). Номер приводим к +996… / +7…,
 * чтобы «0555 12-34-56», «+996 555 123 456» и «996555123456» (или «8 916…» и
 * «+7 916…») были одним клиентом.
 * vCard — запасной путь для iPhone и компьютера, где браузер не даёт выбрать
 * контакт (Contact Picker API есть только в Chrome на Android).
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

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "=" && /^[0-9A-F]{2}$/i.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(value.charCodeAt(i));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const unescapeText = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Разбор .vcf: один или несколько контактов; без имени или телефона — пропускаем. */
export function parseVcards(text: string): PickedContact[] {
  // Склейка перенесённых строк: пробел/таб в начале — продолжение. «=» в
  // конце — мягкий перенос, но только у quoted-printable: base64 фото тоже
  // кончается на «=», и тогда к нему приклеился бы следующий TEL.
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n")) {
    const last = lines.length - 1;
    const prev = lines[last];
    if (prev !== undefined && /ENCODING=QUOTED-PRINTABLE/i.test(prev.split(":")[0]) && prev.endsWith("="))
      lines[last] = prev.slice(0, -1) + raw;
    else lines.push(raw);
  }
  const contacts: PickedContact[] = [];
  let fn = "";
  let n = "";
  let phones: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const [prop, ...params] = head.split(";");
    const key = prop.replace(/^item\d+\./i, "").toUpperCase();
    let value = line.slice(colon + 1);
    if (params.some((p) => /ENCODING=QUOTED-PRINTABLE/i.test(p))) value = decodeQuotedPrintable(value);
    if (key === "BEGIN" && /VCARD/i.test(value)) {
      fn = "";
      n = "";
      phones = [];
    } else if (key === "FN") fn = unescapeText(value);
    else if (key === "N") n = value.split(";").slice(0, 3).reverse().map(unescapeText).filter(Boolean).join(" ");
    else if (key === "TEL") phones.push(value.replace(/^tel:/i, "").trim());
    else if (key === "END" && /VCARD/i.test(value)) {
      const name = (fn || n).replace(/\s+/g, " ").trim();
      const phone = phones.map(normalizePhone).find(Boolean) ?? "";
      if (name && phone) contacts.push({ name: name.slice(0, 160), phone: phone.slice(0, 40) });
    }
  }
  return contacts;
}
