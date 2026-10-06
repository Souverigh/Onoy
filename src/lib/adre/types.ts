/** ТЗ §6 — JSON-схемы распознавания. Приложение о провайдере не знает. */

export type InvoiceLine = {
  n: number;
  name_raw: string;
  qty: string;
  unit: string;
  price: string;
  sum: string;
  confidence: number;
};

/** Что на фото (ТЗ §15.2): первый шаг распознавания. */
export type DocumentClass =
  | "invoice"
  | "receipt"
  | "statement"
  | "price_list"
  | "notebook"
  | "not_document";

export type DocumentSide = { name_raw: string; phone: string | null };

/** Где на фото верх документа — по нему фото поворачивается (image.ts). */
export type TopSide = "top" | "right" | "bottom" | "left";

/** Половина длинной страницы (image.ts, pageHalves). */
export type PagePart = "upper" | "lower";

export type InvoiceResult = {
  /** Нет в ответах до PROMPT_VERSION v2 — считаем накладной. */
  document_class?: DocumentClass;
  /** Продавец и покупатель как на бумаге; какая сторона — наш магазин, решает classify.ts. */
  seller?: DocumentSide | null;
  buyer?: DocumentSide | null;
  /** На фото только часть документа (нет начала или конца). */
  fragment?: boolean;
  /** Где верх документа на каждом фото, по порядку. */
  page_top_sides?: TopSide[];
  /** Как распознавали: какие фото повернули (номера с 1), читали ли по половинам (pipeline.ts). */
  processing?: { rotatedPages?: number[]; halves?: boolean };
  /** Старые ответы (v1): направление по мнению модели, без знания нашего магазина. */
  document_type?: "invoice_out" | "invoice_in";
  /** v1 — контрагент по мнению модели; v2 — не заполняется, см. classify.ts. */
  counterparty?: { name_raw: string; phone: string | null; confidence: number } | null;
  date: string | null;
  number: string | null;
  lines: InvoiceLine[];
  total_declared: number | null;
  total_computed: number;
  /** До v3 — всегда KGS. */
  currency: "KGS" | "USD" | "RUB";
  /** Откуда валюта: знак на документе, масштаб цен или ничего (тогда сом). До v3 нет. */
  currency_evidence?: "symbol" | "price_scale" | "none";
  warnings: string[];
};

export type ReceiptResult = {
  bank: string | null;
  operation_id: string | null;
  datetime: string | null;
  amount: number;
  /** До v3 нет — сом. */
  currency?: "KGS" | "USD" | "RUB";
  sender_name: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  purpose: string | null;
  confidence: number;
};

/**
 * Чек или квитанция расхода магазина (аренда, доставка, свет, покупка в
 * хозмаге). category — одна из категорий expenses (src/lib/expenses.ts).
 */
export type ExpenseResult = {
  document_class: "receipt" | "invoice" | "bill" | "handwritten" | "not_document";
  vendor: string | null;
  datetime: string | null;
  amount: number;
  currency?: "KGS" | "USD" | "RUB";
  description: string | null;
  category: "rent" | "salary" | "transport" | "utilities" | "taxes" | "supplies" | "food" | "other";
  confidence: number;
};

/** Страница тетради долгов при переносе: «имя — сумма», сумма со знаком. */
export type NotebookRow = {
  name_raw: string;
  phone: string | null;
  /** Дата долга, как написана («15.09»); нет — null. */
  date?: string | null;
  amount: number;
  confidence: number;
};
export type NotebookResult = { rows: NotebookRow[]; warnings: string[] };

export type RawCall<T> = { result: T; raw: unknown; costUsd: number | null };

/** Страница документа: у многостраничной накладной их несколько, по порядку. */
export type PhotoPage = { photo: Buffer; mimeType: string };

export interface RecognitionProvider {
  name: string;
  model: string;
  recognizeInvoice(pages: PhotoPage[], part?: PagePart): Promise<RawCall<InvoiceResult>>;
  recognizeReceipt(photo: Buffer, mimeType: string): Promise<RawCall<ReceiptResult>>;
  recognizeNotebook(pages: PhotoPage[]): Promise<RawCall<NotebookResult>>;
  recognizeExpense(pages: PhotoPage[]): Promise<RawCall<ExpenseResult>>;
}
