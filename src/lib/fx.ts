import "server-only";
import { ratePair, type Currency } from "./currency";

/**
 * Официальный курс на сегодня (решение пользователя 28.09.2026: курс НБКР
 * автоматически, продавец может поправить в записи). Пары с сомом — НБКР
 * (сом за единицу), доллар/рубль — ЦБ РФ (рублей за доллар). Ответ банка
 * кешируется на час; банк недоступен — null, продавец вводит курс сам.
 */
export type RateQuote = { rate: number; date: string; source: "НБКР" | "ЦБ РФ" };

const HOUR = 3600;

async function fetchXml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { next: { revalidate: HOUR }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    // Оба банка отдают windows-1251.
    return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
  } catch (error) {
    console.error("fx: rate fetch failed", url, error);
    return null;
  }
}

const number = (raw: string) => Number(raw.replace(/\s/g, "").replace(",", "."));

/** НБКР: <Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4482</Value>. */
export function parseNbkr(xml: string): { date: string; rates: Partial<Record<string, number>> } | null {
  const date = /Date="(\d{2}\.\d{2}\.\d{4})"/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Partial<Record<string, number>> = {};
  for (const m of xml.matchAll(
    /<Currency ISOCode="([A-Z]{3})">\s*<Nominal>(\d+)<\/Nominal>\s*<Value>([\d\s,.]+)<\/Value>/g,
  ))
    rates[m[1]] = number(m[3]) / Number(m[2]);
  return { date, rates };
}

/** ЦБ РФ: <CharCode>USD</CharCode><Nominal>1</Nominal>…<Value>81,5</Value>. */
export function parseCbr(xml: string): { date: string; rates: Partial<Record<string, number>> } | null {
  const date = /Date="(\d{2}\.\d{2}\.\d{4})"/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Partial<Record<string, number>> = {};
  for (const m of xml.matchAll(
    /<CharCode>([A-Z]{3})<\/CharCode>\s*<Nominal>(\d+)<\/Nominal>\s*<Name>[^<]*<\/Name>\s*<Value>([\d\s,.]+)<\/Value>/g,
  ))
    rates[m[1]] = number(m[3]) / Number(m[2]);
  return { date, rates };
}

type Feed = { date: string; rates: Partial<Record<string, number>> } | null;
const FEEDS = {
  nbkr: { url: "https://www.nbkr.kg/XML/daily.xml", parse: parseNbkr, source: "НБКР" as const },
  cbr: { url: "https://www.cbr.ru/scripts/XML_daily.asp", parse: parseCbr, source: "ЦБ РФ" as const },
};

async function loadFeed(name: keyof typeof FEEDS): Promise<Feed> {
  const xml = await fetchXml(FEEDS[name].url);
  return xml ? FEEDS[name].parse(xml) : null;
}

/** Курсы для всех пар из списка валют: «1 сильная = rate слабой», ключ `USD/KGS`. */
export async function officialRates(currencies: Currency[]): Promise<Record<string, RateQuote>> {
  const unique = [...new Set(currencies)];
  const pairs: [Currency, Currency][] = [];
  for (let i = 0; i < unique.length; i++)
    for (let j = i + 1; j < unique.length; j++) pairs.push(ratePair(unique[i], unique[j]));
  // Пары с сомом — НБКР, доллар/рубль — ЦБ РФ; каждый банк — один запрос.
  const feedOf = (weak: Currency) => (weak === "KGS" ? "nbkr" : "cbr") as keyof typeof FEEDS;
  const needed = [...new Set(pairs.map(([, weak]) => feedOf(weak)))];
  const loaded = new Map(await Promise.all(needed.map(async (n) => [n, await loadFeed(n)] as const)));
  const result: Record<string, RateQuote> = {};
  for (const [strong, weak] of pairs) {
    const name = feedOf(weak);
    const feed = loaded.get(name);
    const rate = feed?.rates[strong];
    if (!feed || !rate || !Number.isFinite(rate) || rate <= 0) continue;
    result[`${strong}/${weak}`] = { rate: Math.round(rate * 1e4) / 1e4, date: feed.date, source: FEEDS[name].source };
  }
  return result;
}
