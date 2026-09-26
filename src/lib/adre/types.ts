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

export type InvoiceResult = {
  document_type: "invoice_out" | "invoice_in";
  counterparty: { name_raw: string; phone: string | null; confidence: number };
  date: string | null;
  number: string | null;
  lines: InvoiceLine[];
  total_declared: number | null;
  total_computed: number;
  currency: "KGS";
  warnings: string[];
};

export type ReceiptResult = {
  bank: string | null;
  operation_id: string | null;
  datetime: string | null;
  amount: number;
  sender_name: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  purpose: string | null;
  confidence: number;
};

export type RawCall<T> = { result: T; raw: unknown; costUsd: number | null };

/** Страница документа: у многостраничной накладной их несколько, по порядку. */
export type PhotoPage = { photo: Buffer; mimeType: string };

export interface RecognitionProvider {
  name: string;
  model: string;
  recognizeInvoice(pages: PhotoPage[]): Promise<RawCall<InvoiceResult>>;
  recognizeReceipt(photo: Buffer, mimeType: string): Promise<RawCall<ReceiptResult>>;
}
