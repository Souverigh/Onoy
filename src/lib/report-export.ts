import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildXlsx, type Cell, type Column } from "./xlsx";
import { period, type PeriodKind } from "./periods";
import { periodReport } from "./period-report";
import { periodProfit } from "./profit";
import { sellerCustomerDebts, sellerDetail, sellersDebtTotals, sellersOverview } from "./seller-sales";
import { memberLabels } from "./members";
import { ruDate } from "./ru-date";
import { money as formatMoney } from "./format";
import { CURRENCY_SIGN, type Currency } from "./currency";
import { debtTotalsByCurrency, foreignBlocks } from "./debt-totals";

/**
 * Отчёт для скачивания (просьба пользователя 21.10.2026): одни и те же данные
 * уходят и в Excel (итоги — первым листом, таблицы — своими листами), и в PDF
 * (всё на одном документе). Цифры — те же, что на экране отчёта.
 */
export type ReportLine = { label: string; value: number; money?: boolean; currency?: Currency };
export type ReportTable = { title: string; columns: Column[]; rows: Cell[][] };
export type ReportDoc = {
  shopName: string;
  title: string;
  /** Период датами: «01.10.2026 – 21.10.2026». */
  periodText: string;
  currency: Currency;
  summary: ReportLine[];
  tables: ReportTable[];
  /** Имя файла латиницей без расширения: «depter-otchet-2026-10». */
  fileBase: string;
};

const fmtMoney = (value: number, currency: Currency) => formatMoney(value.toFixed(2), currency);
const periodText = (start: string, end: string) => (start === end ? ruDate(start) : `${ruDate(start)} – ${ruDate(end)}`);
const money = (header: string, width = 16): Column => ({ header, width, kind: "money" });
const count = (header: string, width = 10): Column => ({ header, width, kind: "number" });
const text = (header: string, width = 30): Column => ({ header, width });
const date = (header = "Дата"): Column => ({ header, width: 14, kind: "date" });
const day = (header = "Дата"): Column => ({ header, width: 12, kind: "day" });
const asDate = (day: string) => new Date(`${day}T12:00:00+06:00`);

/** Отчёт за месяц или неделю — как на вкладке «Месяц». */
export async function monthReportDoc(
  db: SupabaseClient,
  organizationId: string,
  shopName: string,
  shopCurrency: Currency,
  kind: PeriodKind,
  offset: number,
  today: string,
): Promise<ReportDoc> {
  const p = period(kind, today, offset);
  const [report, sellers, owed, profit, debts] = await Promise.all([
    periodReport(db, organizationId, p),
    sellersOverview(db, organizationId, p.start, p.through, shopCurrency),
    sellersDebtTotals(db, organizationId, shopCurrency).catch(() => new Map<string, number>()),
    periodProfit(db, organizationId, shopCurrency, p.start, p.through).catch(() => null),
    debtTotalsByCurrency(db, organizationId, shopCurrency).catch(() => []),
  ]);
  const c = report.current;
  const summary: ReportLine[] = [
    { label: "Продано", value: c.sold, money: true },
    { label: "  в долг", value: c.soldCredit, money: true },
    { label: "  сразу наличными", value: c.soldCash, money: true },
    { label: "Продаж", value: c.salesCount },
    { label: "Собрано с клиентов", value: c.collected, money: true },
    { label: "Товар от поставщиков", value: c.purchased, money: true },
    { label: "Оплачено поставщикам", value: c.paidSuppliers, money: true },
    { label: "Расходы", value: c.expenses, money: true },
    ...(profit ? [{ label: "Прибыль", value: profit.profit, money: true }] : []),
    // Другие валюты — своими строками, как блоки «В $» на экране.
    ...foreignBlocks(report.foreign, debts, report.currency).flatMap((b) =>
      b.lines.map((l) => ({ label: `В ${CURRENCY_SIGN[b.currency]}: ${l.label.toLowerCase()}`, value: l.value, money: true, currency: b.currency })),
    ),
  ];
  const tables: ReportTable[] = [
    {
      title: "По дням",
      columns: [day(), money("Продано"), money("Собрано")],
      // Только наступившие дни: будущие дни месяца — не нули, их просто нет.
      rows: report.days.filter((d) => d.date <= p.through).map((d) => [asDate(d.date), d.sold, d.collected]),
    },
  ];
  if (profit?.topProducts.length)
    tables.push({
      title: "Лучшие товары",
      columns: [text("Товар", 36), count("Продано", 12), text("Ед.", 8), money("Выручка"), money("Прибыль")],
      rows: profit.topProducts.map((t) => [t.name, t.qty, t.unit, t.revenue, t.profit]),
    });
  if (profit?.topCustomers.length)
    tables.push({
      title: "Лучшие клиенты",
      columns: [text("Клиент"), count("Продаж"), money("Купил")],
      rows: profit.topCustomers.map((t) => [t.name, t.count, t.sold]),
    });
  if (report.topDebtors.length)
    tables.push({
      title: "Кто больше всех должен",
      columns: [text("Клиент"), money("Долг"), count("Дней долгу", 12)],
      rows: report.topDebtors.map((d) => [d.name, d.balance, d.oldestDays]),
    });
  if (sellers.some((s) => s.role === "staff"))
    tables.push(sellersTable(sellers, owed));
  const kindWord = kind === "week" ? "nedelya" : "mesyac";
  return {
    shopName,
    title: kind === "week" ? "Отчёт за неделю" : "Отчёт за месяц",
    periodText: periodText(p.start, p.through),
    currency: report.currency,
    summary,
    tables,
    fileBase: `depter-otchet-${kindWord}-${p.start}`,
  };
}

function sellersTable(
  rows: Awaited<ReturnType<typeof sellersOverview>>,
  owed: Map<string, number>,
): ReportTable {
  return {
    title: "По продавцам",
    columns: [
      text("Кто", 24),
      count("Продаж"),
      count("Клиентов"),
      money("Продано"),
      money("Собрано"),
      money("Должны клиенты"),
      ...(rows.some((r) => r.foreign.length) ? [text("В другой валюте", 26)] : []),
    ],
    rows: rows.map((r) => [
      r.name,
      r.count,
      r.customers,
      r.sold,
      r.collected,
      r.id ? (owed.get(r.id) ?? 0) : null,
      ...(rows.some((x) => x.foreign.length)
        ? [
            r.foreign
              .map((f) => `продано ${fmtMoney(f.sold, f.currency)}${f.collected ? `, собрано ${fmtMoney(f.collected, f.currency)}` : ""}`)
              .join("; "),
          ]
        : []),
    ]),
  };
}

/** Продажи продавцов: все продавцы (владелец) или один продавец — как на вкладке «Продавцы». */
export async function sellersReportDoc(
  db: SupabaseClient,
  organizationId: string,
  shopName: string,
  shopCurrency: Currency,
  opts: { sellerId: string | null; ownName: boolean; start: string; end: string },
): Promise<ReportDoc> {
  const { sellerId, start, end } = opts;
  const base = { shopName, periodText: periodText(start, end), currency: shopCurrency };
  if (!sellerId) {
    const [rows, owed] = await Promise.all([
      sellersOverview(db, organizationId, start, end, shopCurrency),
      sellersDebtTotals(db, organizationId, shopCurrency),
    ]);
    return {
      ...base,
      title: "Продажи продавцов",
      summary: [
        { label: "Продано всеми", value: rows.reduce((t, r) => t + r.sold, 0), money: true },
        { label: "Собрано всеми", value: rows.reduce((t, r) => t + r.collected, 0), money: true },
        { label: "Продаж", value: rows.reduce((t, r) => t + r.count, 0) },
      ],
      tables: [sellersTable(rows, owed)],
      fileBase: `depter-prodavcy-${start}`,
    };
  }
  const [detail, members, debts] = await Promise.all([
    sellerDetail(db, organizationId, sellerId, start, end, shopCurrency),
    memberLabels(db, organizationId),
    sellerCustomerDebts(db, organizationId, sellerId, shopCurrency),
  ]);
  const name = opts.ownName ? "Мои продажи" : (members.get(sellerId)?.name ?? "Продавец");
  return {
    ...base,
    title: opts.ownName ? name : `Продажи: ${name}`,
    summary: [
      { label: "Продано", value: detail.sold, money: true },
      { label: "  в долг", value: detail.credit, money: true },
      { label: "  сразу наличными", value: detail.cash, money: true },
      { label: "Продаж", value: detail.count },
      { label: "Собрано", value: detail.collected, money: true },
      { label: "Должны его клиенты сейчас", value: debts.total, money: true },
      ...detail.foreign.map((f) => ({ label: `В ${CURRENCY_SIGN[f.currency]}: продано`, value: f.sold, money: true, currency: f.currency })),
      ...debts.foreign.map((f) => ({ label: `В ${CURRENCY_SIGN[f.currency]}: должны клиенты`, value: f.total, money: true, currency: f.currency })),
    ],
    tables: [
      {
        title: "По дням",
        columns: [day(), count("Продаж"), count("Клиентов"), money("Продано")],
        rows: detail.days.map((d) => [asDate(d.date), d.count, d.customers, d.sold]),
      },
      {
        title: "По клиентам",
        columns: [text("Клиент"), count("Продаж"), money("Продано")],
        rows: detail.customers.map((c) => [c.name, c.count, c.sold]),
      },
      {
        title: "Все продажи",
        columns: [{ ...date(), width: 17 }, text("Клиент"), money("Сумма"), text("Валюта", 8), text("Оплата", 12)],
        rows: detail.sales.map((s) => [new Date(s.date), s.customerName, s.total, s.currency, s.paid ? "Наличными" : "В долг"]),
      },
    ],
    fileBase: `depter-prodazhi-${start === end ? start : `${start}_${end}`}`,
  };
}

/** Excel: «Итоги» первым листом, потом каждая таблица своим листом. */
export function reportXlsx(doc: ReportDoc) {
  return buildXlsx([
    {
      name: "Итоги",
      columns: [text(`${doc.title} · ${doc.periodText}`, 40), money("Сумма", 18), text("Валюта", 8)],
      rows: doc.summary.map((l) => [l.label.trim(), l.value, l.money ? (l.currency ?? doc.currency) : ""]),
    },
    ...doc.tables.map((t) => ({ name: t.title, columns: t.columns, rows: t.rows })),
  ]);
}

/** Заголовки ответа: латиница в filename, кириллица — через filename* (RFC 5987). */
export function downloadHeaders(doc: ReportDoc, format: "xlsx" | "pdf") {
  const type =
    format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
  const name = `${doc.title} ${doc.periodText}.${format}`;
  return {
    "content-type": type,
    "content-disposition": `attachment; filename="${doc.fileBase}.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
}
