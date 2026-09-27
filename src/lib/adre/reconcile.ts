import type { InvoiceResult } from "./types";

/** Допуск сверки, сом (ТЗ §6). */
export const TOLERANCE = 1;

/**
 * Сверка накладной — три суммы:
 *  - `computed` — наш итог по строкам (Σ qty×price, normalize.ts);
 *  - `paper` — «Итого», написанное на бумаге (total_declared), если видно;
 *  - `entered` — сумма, которую продавец ввёл в записи.
 * Плюс каждая строка: qty×price против суммы строки на бумаге.
 * «Оцифрована» — только когда сошлось всё, что есть; итога на бумаге нет —
 * сверяем без него.
 */
export type Reconciliation = {
  computed: number;
  paper: number | null;
  entered: number | null;
  /** Номера строк (n), где qty×price не равно сумме строки на бумаге. */
  badLines: number[];
  /** Итог на бумаге не равен сумме строк: пропущена/не так прочитана строка или ошибка в сложении. */
  paperMismatch: boolean;
  /** Сумма в записи не равна сумме строк. */
  enteredMismatch: boolean;
  ok: boolean;
};

const differs = (a: number, b: number) => Math.abs(a - b) > TOLERANCE;

export function reconcileInvoice(result: InvoiceResult, entered: number | null): Reconciliation {
  const computed = result.total_computed;
  const rawPaper = Number(result.total_declared);
  const paper = result.total_declared != null && Number.isFinite(rawPaper) && rawPaper > 0 ? rawPaper : null;
  const badLines = result.lines
    .filter((line) => differs(Number(line.qty) * Number(line.price), Number(line.sum)))
    .map((line) => line.n);
  const paperMismatch = paper != null && differs(computed, paper);
  const enteredMismatch = entered != null && differs(computed, entered);
  return {
    computed,
    paper,
    entered,
    badLines,
    paperMismatch,
    enteredMismatch,
    ok: badLines.length === 0 && !paperMismatch && !enteredMismatch,
  };
}
