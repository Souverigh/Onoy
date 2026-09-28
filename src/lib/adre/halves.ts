import type { InvoiceLine } from "./types";

/**
 * Склейка строк двух половин длинной страницы (pipeline.ts). Половины
 * перекрываются, поэтому строки на стыке могут прийти дважды:
 *  - на бумаге есть колонка «№» (у всех строк n > 0) — склеиваем по номеру;
 *    из двух вариантов одной строки берём тот, где qty×price = сумма;
 *  - номеров нет (n = 0) — ищем на стыке одинаковые строки (кол-во, цена,
 *    сумма) в конце верхней и начале нижней половины.
 * На выходе строки пронумерованы подряд с 1.
 */
const MAX_OVERLAP_LINES = 4;

function arithmeticOk(line: InvoiceLine) {
  const sum = Number(line.sum);
  return line.sum !== "" && Math.abs(Number(line.qty) * Number(line.price) - sum) <= 1;
}

function sameNumbers(a: InvoiceLine, b: InvoiceLine) {
  return (
    Number(a.qty) === Number(b.qty) &&
    Number(a.price) === Number(b.price) &&
    Number(a.sum) === Number(b.sum)
  );
}

export function mergeHalves(upper: InvoiceLine[], lower: InvoiceLine[]): InvoiceLine[] {
  let merged: InvoiceLine[];
  const numbered = [...upper, ...lower].every((line) => Number(line.n) > 0);
  if (numbered) {
    const byNumber = new Map<number, InvoiceLine>();
    for (const line of [...upper, ...lower]) {
      const seen = byNumber.get(line.n);
      if (!seen || (!arithmeticOk(seen) && arithmeticOk(line))) byNumber.set(line.n, line);
    }
    merged = [...byNumber.entries()].sort(([a], [b]) => a - b).map(([, line]) => line);
  } else {
    let overlap = 0;
    for (let k = Math.min(MAX_OVERLAP_LINES, upper.length, lower.length); k > 0; k--) {
      const tail = upper.slice(-k);
      if (tail.every((line, i) => sameNumbers(line, lower[i]))) {
        overlap = k;
        break;
      }
    }
    merged = [...upper, ...lower.slice(overlap)];
  }
  return merged.map((line, i) => ({ ...line, n: i + 1 }));
}

