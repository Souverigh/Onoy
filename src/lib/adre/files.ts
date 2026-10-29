import type { InvoiceFile, InvoiceResult } from "./types";

/**
 * Несколько PDF в одной записи — это разные накладные, а не листы одной
 * (случай 28.10.2026: второй файл «не читался» — модель видела одну
 * накладную и брала шапку и итог первой). Каждый файл распознан отдельно
 * (pipeline.ts); здесь — одна запись из всех: строки подряд со сквозной
 * нумерацией, итоги складываются, по каждой накладной — номер, дата и сумма
 * (processing.files) для плашки в форме. Итог по строкам пересчитает
 * normalizeInvoiceResult после (recognize.ts).
 */
export function mergeInvoiceFiles(results: InvoiceResult[]): InvoiceResult {
  const files: InvoiceFile[] = results.map((r) => ({
    number: r.number,
    date: r.date,
    total: r.total_declared != null && r.total_declared > 0 ? r.total_declared : Number(r.total_computed) || 0,
    currency: r.currency,
    seller: r.seller?.name_raw ?? null,
    buyer: r.buyer?.name_raw ?? null,
  }));
  const round = (n: number) => Math.round(n * 100) / 100;
  const first = results[0];
  let n = 0;
  const lines = results.flatMap((r) => r.lines.map((line) => ({ ...line, n: ++n })));
  // Итог по бумаге — только если он виден на каждой накладной, иначе сумма вышла бы неполной.
  const declared = results.every((r) => r.total_declared != null && r.total_declared > 0)
    ? round(results.reduce((sum, r) => sum + (r.total_declared ?? 0), 0))
    : null;
  const currencies = new Set(results.map((r) => r.currency));
  const numbers = results.map((r) => r.number).filter((x): x is string => Boolean(x));
  return {
    ...first,
    document_class: results.some((r) => (r.document_class ?? "invoice") === "invoice") ? "invoice" : first.document_class,
    seller: results.find((r) => r.seller)?.seller ?? null,
    buyer: results.find((r) => r.buyer)?.buyer ?? null,
    fragment: results.some((r) => r.fragment),
    page_top_sides: results.flatMap((r) => r.page_top_sides ?? []),
    date: results.find((r) => r.date)?.date ?? null,
    number: numbers.length ? numbers.join(", ") : null,
    lines,
    total_declared: declared,
    total_computed: round(results.reduce((sum, r) => sum + (Number(r.total_computed) || 0), 0)),
    warnings: [
      ...(currencies.size > 1 ? ["Накладные в разных валютах - сумма сложена как есть, проверьте её."] : []),
      ...results.flatMap((r, i) => (r.warnings ?? []).map((w) => `Накладная ${i + 1}: ${w}`)),
    ],
    processing: { ...first.processing, files },
  };
}

/** Разные покупатели (продажа) или продавцы (приход) в накладных — возможно, это разные записи. */
export function differentParties(files: InvoiceFile[], side: "buyer" | "seller"): string[] {
  const names = new Map<string, string>();
  for (const f of files) {
    const name = f[side]?.trim();
    if (name) names.set(name.toLowerCase().replace(/\s+/g, " "), name);
  }
  return names.size > 1 ? [...names.values()] : [];
}
