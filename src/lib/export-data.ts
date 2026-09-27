import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sheet } from "./xlsx";
import { paymentLabelWithSide, type PaymentKind } from "./entry-labels";

/** Таблицы выгрузки (ТЗ: «экспорт в Excel — отдельные таблицы и вся база одной кнопкой»). */
export const EXPORT_TABLES = {
  customers: "Клиенты",
  suppliers: "Поставщики",
  sales: "Продажи",
  purchases: "Приходы",
  payments: "Оплаты",
  lines: "Позиции накладных",
} as const;
export type ExportTable = keyof typeof EXPORT_TABLES;
export const isExportTable = (value: string): value is ExportTable => value in EXPORT_TABLES;

const PAGE = 1000; // Supabase отдаёт не больше 1000 строк за запрос
const LIMIT = 100_000;

/** Все строки таблицы магазина — постранично, по порядку. */
async function all<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  organizationId: string,
  order: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < LIMIT; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId)
      .order(order)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Не удалось выгрузить ${table}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const date = (v: string | null | undefined) => (v ? new Date(v) : null);
const yes = (v: boolean | null | undefined) => (v ? "да" : "");
const onlyDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00+06:00`) : null);

type Party = { id: string; name: string };

export async function exportSheets(
  db: SupabaseClient,
  organizationId: string,
  tables: ExportTable[],
): Promise<Sheet[]> {
  const need = new Set(tables);
  const needParties = need.has("sales") || need.has("purchases") || need.has("payments") || need.has("lines");
  const [customers, suppliers] = await Promise.all([
    need.has("customers") || needParties
      ? all<Party & { phone: string; notes: string; balance: string; credit_limit: string | null; promised_date: string | null; created_at: string }>(
          db, "customer_balances", "id,name,phone,notes,balance,credit_limit,promised_date,created_at", organizationId, "name")
      : Promise.resolve([]),
    need.has("suppliers") || needParties
      ? all<Party & { phone: string; notes: string; balance: string; created_at: string }>(
          db, "supplier_balances", "id,name,phone,notes,balance,created_at", organizationId, "name")
      : Promise.resolve([]),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const sheets: Sheet[] = [];

  if (need.has("customers"))
    sheets.push({
      name: EXPORT_TABLES.customers,
      columns: [
        { header: "Имя", width: 30 },
        { header: "Телефон", width: 18 },
        { header: "Долг (минус — аванс), сом", width: 22, kind: "money" },
        { header: "Лимит долга, сом", width: 18, kind: "money" },
        { header: "Обещал оплатить до", width: 20, kind: "date" },
        { header: "Заметка", width: 40 },
        { header: "Добавлен", width: 18, kind: "date" },
      ],
      rows: customers.map((c) => [
        c.name, c.phone, num(c.balance), num(c.credit_limit), onlyDate(c.promised_date), c.notes, date(c.created_at),
      ]),
    });

  if (need.has("suppliers"))
    sheets.push({
      name: EXPORT_TABLES.suppliers,
      columns: [
        { header: "Название", width: 30 },
        { header: "Телефон", width: 18 },
        { header: "Мы должны (минус — аванс), сом", width: 26, kind: "money" },
        { header: "Заметка", width: 40 },
        { header: "Добавлен", width: 18, kind: "date" },
      ],
      rows: suppliers.map((s) => [s.name, s.phone, num(s.balance), s.notes, date(s.created_at)]),
    });

  if (need.has("sales")) {
    const rows = await all<{
      occurred_at: string; customer_id: string; total: string; paid_immediately: boolean; is_opening: boolean;
      reversed_at: string | null; reversal_comment: string | null; status: string;
    }>(db, "sales", "id,occurred_at,customer_id,total,paid_immediately,is_opening,reversed_at,reversal_comment,status", organizationId, "occurred_at");
    sheets.push({
      name: EXPORT_TABLES.sales,
      columns: [
        { header: "Дата", width: 18, kind: "date" },
        { header: "Клиент", width: 30 },
        { header: "Сумма, сом", width: 16, kind: "money" },
        { header: "Оплачено наличными", width: 12 },
        { header: "Долг из тетради", width: 12 },
        { header: "Отменена", width: 18, kind: "date" },
        { header: "Причина отмены", width: 36 },
      ],
      rows: rows
        .filter((r) => r.status === "posted")
        .map((r) => [
          date(r.occurred_at), customerName.get(r.customer_id) ?? "", num(r.total), yes(r.paid_immediately),
          yes(r.is_opening), date(r.reversed_at), r.reversal_comment,
        ]),
    });
  }

  if (need.has("purchases")) {
    const rows = await all<{
      occurred_at: string; supplier_id: string; total: string; is_opening: boolean;
      reversed_at: string | null; reversal_comment: string | null; status: string;
    }>(db, "purchases", "id,occurred_at,supplier_id,total,is_opening,reversed_at,reversal_comment,status", organizationId, "occurred_at");
    sheets.push({
      name: EXPORT_TABLES.purchases,
      columns: [
        { header: "Дата", width: 18, kind: "date" },
        { header: "Поставщик", width: 30 },
        { header: "Сумма, сом", width: 16, kind: "money" },
        { header: "Долг из тетради", width: 12 },
        { header: "Отменён", width: 18, kind: "date" },
        { header: "Причина отмены", width: 36 },
      ],
      rows: rows
        .filter((r) => r.status === "posted")
        .map((r) => [
          date(r.occurred_at), supplierName.get(r.supplier_id) ?? "", num(r.total), yes(r.is_opening),
          date(r.reversed_at), r.reversal_comment,
        ]),
    });
  }

  if (need.has("payments")) {
    const rows = await all<{
      occurred_at: string; direction: string; customer_id: string | null; supplier_id: string | null;
      amount: string; status: string; bank_reference: string | null; claim_comment: string | null;
      is_opening: boolean; reversed_at: string | null; reversal_comment: string | null;
      kind: PaymentKind; note: string | null;
    }>(db, "payments", "id,occurred_at,direction,customer_id,supplier_id,amount,status,bank_reference,claim_comment,is_opening,reversed_at,reversal_comment,kind,note", organizationId, "occurred_at");
    const statusLabel: Record<string, string> = { confirmed: "подтверждена", pending: "заявка ждёт", rejected: "отклонена" };
    sheets.push({
      name: EXPORT_TABLES.payments,
      columns: [
        { header: "Дата", width: 18, kind: "date" },
        { header: "Вид", width: 26 },
        { header: "Клиент / поставщик", width: 30 },
        { header: "Сумма, сом", width: 16, kind: "money" },
        { header: "Статус", width: 16 },
        { header: "Номер перевода", width: 20 },
        { header: "Комментарий", width: 36 },
        { header: "Аванс из тетради", width: 12 },
        { header: "Отменена", width: 18, kind: "date" },
        { header: "Причина отмены", width: 36 },
      ],
      rows: rows.map((r) => [
        date(r.occurred_at),
        r.kind === "payment"
          ? r.direction === "incoming"
            ? "оплата: клиент → магазин"
            : "оплата: магазин → поставщик"
          : paymentLabelWithSide(r.kind, r.direction as "incoming" | "outgoing").toLowerCase(),
        r.customer_id ? customerName.get(r.customer_id) ?? "" : r.supplier_id ? supplierName.get(r.supplier_id) ?? "" : "",
        num(r.amount), statusLabel[r.status] ?? r.status, r.bank_reference, r.note ?? r.claim_comment, yes(r.is_opening),
        date(r.reversed_at), r.reversal_comment,
      ]),
    });
  }

  if (need.has("lines")) {
    // Позиции — с датой и контрагентом записи, к которой приложена накладная.
    const [lines, sales, purchases] = await Promise.all([
      all<{ document_id: string; n: number; name_raw: string; qty: string; unit: string; price: string; sum: string }>(
        db, "document_lines", "id,document_id,n,name_raw,qty,unit,price,sum", organizationId, "document_id"),
      all<{ document_id: string | null; occurred_at: string; customer_id: string; reversed_at: string | null }>(
        db, "sales", "id,document_id,occurred_at,customer_id,reversed_at", organizationId, "occurred_at"),
      all<{ document_id: string | null; occurred_at: string; supplier_id: string; reversed_at: string | null }>(
        db, "purchases", "id,document_id,occurred_at,supplier_id,reversed_at", organizationId, "occurred_at"),
    ]);
    const owner = new Map<string, { kind: string; at: string; party: string; reversed: boolean }>();
    for (const s of sales)
      if (s.document_id)
        owner.set(s.document_id, { kind: "продажа", at: s.occurred_at, party: customerName.get(s.customer_id) ?? "", reversed: !!s.reversed_at });
    for (const p of purchases)
      if (p.document_id)
        owner.set(p.document_id, { kind: "приход", at: p.occurred_at, party: supplierName.get(p.supplier_id) ?? "", reversed: !!p.reversed_at });
    const rows = lines
      .filter((l) => owner.has(l.document_id))
      .map((l) => ({ l, o: owner.get(l.document_id)! }))
      .sort((a, b) => a.o.at.localeCompare(b.o.at) || a.l.document_id.localeCompare(b.l.document_id) || a.l.n - b.l.n);
    sheets.push({
      name: EXPORT_TABLES.lines,
      columns: [
        { header: "Дата записи", width: 18, kind: "date" },
        { header: "Запись", width: 12 },
        { header: "Клиент / поставщик", width: 30 },
        { header: "№", width: 6, kind: "number" },
        { header: "Наименование", width: 40 },
        { header: "Кол-во", width: 10, kind: "number" },
        { header: "Ед.", width: 8 },
        { header: "Цена, сом", width: 14, kind: "money" },
        { header: "Сумма, сом", width: 14, kind: "money" },
        { header: "Запись отменена", width: 12 },
      ],
      rows: rows.map(({ l, o }) => [
        date(o.at), o.kind, o.party, l.n, l.name_raw, num(l.qty), l.unit, num(l.price), num(l.sum), yes(o.reversed),
      ]),
    });
  }
  return sheets;
}
