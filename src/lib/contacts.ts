/**
 * Клиенты из контактов телефона (ТЗ §4 Б). Номер приводим к +996…, чтобы
 * «0555 12-34-56», «+996 555 123 456» и «996555123456» были одним клиентом.
 * vCard — запасной путь для iPhone и компьютера, где браузер не даёт выбрать
 * контакт (Contact Picker API есть только в Chrome на Android).
 */
export type PickedContact = { name: string; phone: string };

/** Кыргызский мобильный → «+996XXXXXXXXX»; прочие номера — только цифры с «+». */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("996")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+996${digits.slice(1)}`;
  if (digits.length === 9) return `+996${digits}`;
  return `+${digits}`;
}

/** Ключ для сравнения номеров: последние 9 цифр (номер без кода страны и нуля). */
export function phoneKey(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
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
