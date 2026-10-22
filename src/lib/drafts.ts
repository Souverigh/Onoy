import type { QuickProduct } from "@/app/(workspace)/stock/actions";

export type DraftKind = "sale" | "purchase";

/**
 * Черновик формы «товары со склада» (миграция record_drafts.sql): что было
 * введено, плюс клиент и сумма для списка черновиков. Товар — снимком: если
 * его уже убрали со склада, строку всё равно видно.
 */
export type DraftData = {
  party: string;
  partyName: string;
  lines: { product: QuickProduct; qty: string; price: string }[];
  paidNow: boolean;
  recordDate: string;
  rate: string;
  total: string;
  currency: string;
  /** Комментарий к записи. */
  note?: string;
  /** «Исправить» / «Открыть заново»: отменённая запись — продавец берётся из неё. */
  from?: string;
  /** Продавец, выбранный владельцем при исправлении; пусто — как в отменённой. */
  madeBy?: string;
};

export type Draft = { id: string; kind: DraftKind; data: DraftData; updated_at: string };

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
const uuid = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;

/** Что пришло из базы или от формы — в известную форму; мусор отбрасываем. */
export function draftData(raw: unknown): DraftData {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lines = Array.isArray(d.lines) ? d.lines : [];
  return {
    party: text(d.party, 36),
    partyName: text(d.partyName),
    lines: lines
      .filter((l): l is { product: QuickProduct; qty: unknown; price: unknown } =>
        Boolean(l && typeof l === "object" && (l as { product?: { id?: unknown } }).product?.id),
      )
      .slice(0, 200)
      .map((l) => ({ product: l.product, qty: text(l.qty, 30), price: text(l.price, 30) })),
    paidNow: d.paidNow === true,
    recordDate: text(d.recordDate, 10),
    rate: text(d.rate, 30),
    total: text(d.total, 30),
    currency: text(d.currency, 3),
    note: text(d.note, 500),
    from: uuid(d.from),
    madeBy: uuid(d.madeBy),
  };
}
