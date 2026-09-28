import type { DocumentClass, InvoiceResult } from "./types";

/**
 * Тип документа и направление — до записи (ТЗ §15.1 п. 3, §15.2). Модель не
 * знает, какой магазин наш, поэтому возвращает продавца и покупателя как на
 * бумаге, а сторону решаем здесь — по названиям магазина из настроек
 * (organizations.name + document_names). Наш магазин — продавец → накладная
 * клиенту (продажа); покупатель → от поставщика (приход); контрагент —
 * другая сторона. Так пометка «на фото Маликнур» больше не ставится на имя
 * самого магазина.
 */

export type Direction = "in" | "out";
type Similarity = (a: string, b: string) => number;

export type DocumentVerdict =
  | { ok: true; counterparty: string | null; fragment: boolean }
  | {
      ok: false;
      reason: Exclude<DocumentClass, "invoice">;
      counterparty: null;
      fragment: boolean;
    }
  | {
      ok: false;
      reason: "direction";
      /** Какую запись это похоже: накладная поставщика в продаже → приход. */
      suggestedKind: "purchase" | "sale";
      counterparty: string | null;
      fragment: boolean;
    };

// Строго: у магазина-дилера в названии бывает имя поставщика («СКЛАД №1 JLD
// HOROZ ELECTRIC» против «HOROZ ELECTRIC») — похожесть 0.6 их путает.
const SAME_NAME = 0.8;

function plain(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Имя со шапки — наш магазин? Похоже целиком (коэффициент Дайса) или
 * содержит название магазина словом: «ИП D MALIKNUR SATAROV» и «maliknur».
 */
export function ownNameMatcher(ownNames: string[], similarity: Similarity) {
  const names = ownNames.map((n) => n.trim()).filter(Boolean);
  const plainNames = names.map(plain).filter((n) => n.length >= 4);
  return (name: string): boolean => {
    const value = name.trim();
    if (!value) return false;
    const plainValue = ` ${plain(value)} `;
    return (
      names.some((own) => similarity(value, own) >= SAME_NAME) ||
      plainNames.some((own) => plainValue.includes(` ${own} `))
    );
  };
}

/** Направление и контрагент по сторонам документа; null — не поняли. */
export function documentSides(
  result: Pick<InvoiceResult, "seller" | "buyer">,
  isOwn: (name: string) => boolean,
): { direction: Direction | null; counterparty: string | null } {
  const seller = result.seller?.name_raw?.trim() || "";
  const buyer = result.buyer?.name_raw?.trim() || "";
  const sellerOwn = seller !== "" && isOwn(seller);
  const buyerOwn = buyer !== "" && isOwn(buyer);
  if (sellerOwn && !buyerOwn) return { direction: "out", counterparty: buyer || null };
  if (buyerOwn && !sellerOwn) return { direction: "in", counterparty: seller || null };
  return { direction: null, counterparty: null };
}

/**
 * Годится ли документ для записи, которую выбрал продавец. Не блокирует —
 * форма предлагает нужный сценарий, продавец может записать и так.
 */
export function checkDocument(
  result: InvoiceResult,
  kind: "purchase" | "sale",
  isOwn: (name: string) => boolean,
): DocumentVerdict {
  const fragment = result.fragment === true;
  const documentClass = result.document_class ?? "invoice";
  if (documentClass !== "invoice")
    return { ok: false, reason: documentClass, counterparty: null, fragment };
  const sides = documentSides(result, isOwn);
  const expected: Direction = kind === "purchase" ? "in" : "out";
  if (sides.direction && sides.direction !== expected)
    return {
      ok: false,
      reason: "direction",
      suggestedKind: kind === "purchase" ? "sale" : "purchase",
      counterparty: sides.counterparty,
      fragment,
    };
  // Сторону не поняли (наш магазин не назван) — контрагент по выбору
  // продавца: в приходе это продавец на бумаге, в продаже — покупатель.
  const fallback =
    (kind === "purchase" ? result.seller?.name_raw : result.buyer?.name_raw)?.trim() ||
    result.counterparty?.name_raw?.trim() ||
    null;
  return {
    ok: true,
    counterparty: sides.counterparty ?? (fallback && !isOwn(fallback) ? fallback : null),
    fragment,
  };
}
