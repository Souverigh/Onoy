import type { InvoiceResult, ReceiptResult, RecognitionProvider, RawCall } from "./types.ts";

const invoiceSchema = {
  type: "object",
  properties: {
    document_type: { type: "string", enum: ["invoice_out", "invoice_in"] },
    counterparty: {
      type: "object",
      properties: {
        name_raw: { type: "string" },
        phone: { type: "string", nullable: true },
        confidence: { type: "number" },
      },
      required: ["name_raw", "confidence"],
    },
    date: { type: "string", nullable: true },
    number: { type: "string", nullable: true },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          name_raw: { type: "string" },
          qty: { type: "string" },
          unit: { type: "string" },
          price: { type: "string" },
          sum: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["n", "name_raw", "qty", "unit", "price", "sum", "confidence"],
      },
    },
    total_declared: { type: "number", nullable: true },
    total_computed: { type: "number" },
    currency: { type: "string", enum: ["KGS"] },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["document_type", "counterparty", "lines", "total_computed", "currency", "warnings"],
};

const receiptSchema = {
  type: "object",
  properties: {
    bank: { type: "string", nullable: true },
    operation_id: { type: "string", nullable: true },
    datetime: { type: "string", nullable: true },
    amount: { type: "number" },
    sender_name: { type: "string", nullable: true },
    receiver_name: { type: "string", nullable: true },
    receiver_phone: { type: "string", nullable: true },
    purpose: { type: "string", nullable: true },
    confidence: { type: "number" },
  },
  required: ["amount", "confidence"],
};

const invoicePrompt = `Ты распознаёшь рукописную или печатную накладную магазина стройматериалов в Кыргызстане (кириллица, могут быть кыргызские и узбекские имена, сокращения названий товаров). Извлеки контрагента, дату, номер накладной, все позиции (номер строки, название как написано, количество, единицу, цену за единицу, сумму строки, уверенность 0-1 по каждой позиции), итог по бумаге (total_declared, если виден) и посчитанный тобой итог по сумме строк (total_computed). Валюта всегда KGS. Если строка вызывает сомнение (зачёркнуто, неразборчиво) — опиши это в warnings. Отвечай только JSON по заданной схеме, ничего лишнего.`;

const receiptPrompt = `Ты распознаёшь чек или скриншот перевода банка MBank (Кыргызстан). Извлеки банк, номер операции, дату и время, сумму, имя отправителя, имя и телефон получателя, назначение платежа, и уверенность 0-1. Отвечай только JSON по заданной схеме.`;

// Кодируем без Buffer (портируемо между Deno и Node) — по частям, чтобы не
// упереться в лимит аргументов String.fromCharCode на больших фото.
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function callGemini(
  model: string,
  apiKey: string,
  prompt: string,
  schema: object,
  photo: Uint8Array,
  mimeType: string,
): Promise<{ json: unknown; raw: unknown }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: toBase64(photo) } }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`gemini_http_${response.status}: ${text.slice(0, 300)}`);
  }
  const raw = await response.json();
  const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("gemini_empty_response");
  return { json: JSON.parse(text), raw };
}

// Грубая оценка стоимости для метрик пилота (не биллинг) — цены меняются,
// уточняются через GEMINI_PRICE_PER_1K_INPUT/OUTPUT (USD) при необходимости.
function estimateCost(raw: unknown): number | null {
  const usage = (raw as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
    ?.usageMetadata;
  if (!usage) return null;
  const priceIn = Number(Deno.env.get("GEMINI_PRICE_PER_1K_INPUT") ?? "0.0003");
  const priceOut = Number(Deno.env.get("GEMINI_PRICE_PER_1K_OUTPUT") ?? "0.0025");
  const input = (usage.promptTokenCount ?? 0) / 1000;
  const output = (usage.candidatesTokenCount ?? 0) / 1000;
  return Number((input * priceIn + output * priceOut).toFixed(4));
}

export function createGeminiProvider(apiKey: string, model: string): RecognitionProvider {
  return {
    name: "gemini",
    model,
    async recognizeInvoice(photo, mimeType): Promise<RawCall<InvoiceResult>> {
      const { json, raw } = await callGemini(model, apiKey, invoicePrompt, invoiceSchema, photo, mimeType);
      return { result: json as InvoiceResult, raw, costUsd: estimateCost(raw) };
    },
    async recognizeReceipt(photo, mimeType): Promise<RawCall<ReceiptResult>> {
      const { json, raw } = await callGemini(model, apiKey, receiptPrompt, receiptSchema, photo, mimeType);
      return { result: json as ReceiptResult, raw, costUsd: estimateCost(raw) };
    },
  };
}
