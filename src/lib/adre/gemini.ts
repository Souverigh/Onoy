import "server-only";
import type {
  InvoiceResult,
  ReceiptResult,
  NotebookResult,
  RecognitionProvider,
  RawCall,
  PhotoPage,
} from "./types";

const sideSchema = {
  type: "object",
  nullable: true,
  properties: {
    name_raw: { type: "string" },
    phone: { type: "string", nullable: true },
  },
  required: ["name_raw"],
};

const invoiceSchema = {
  type: "object",
  properties: {
    document_class: {
      type: "string",
      enum: ["invoice", "receipt", "statement", "price_list", "notebook", "not_document"],
    },
    seller: sideSchema,
    buyer: sideSchema,
    fragment: { type: "boolean" },
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
  required: ["document_class", "fragment", "lines", "total_computed", "currency", "warnings"],
};

const notebookSchema = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name_raw: { type: "string" },
          phone: { type: "string", nullable: true },
          amount: { type: "number" },
          confidence: { type: "number" },
        },
        required: ["name_raw", "amount", "confidence"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["rows", "warnings"],
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

const invoicePrompt = `Ты распознаёшь документ магазина стройматериалов в Кыргызстане (кириллица, латиница, турецкий; кыргызские и узбекские имена, сокращения названий товаров). Сначала определи, что на фото (document_class): invoice — накладная, счёт или товарный чек со списком отпущенных товаров; receipt — чек или квитанция об оплате, скриншот банковского перевода; statement — выписка или акт сверки: таблица операций по датам с приходом и оплатами (дебет/кредит, Borç/Alacak, сальдо); price_list — прайс-лист (цены без покупателя и количества); notebook — страница тетради долгов (имена и суммы); not_document — документа на фото нет. Если это не invoice — lines оставь пустым, total_computed 0, остальное — что видно. Стороны документа: seller — кто продал и отпустил товар (шапка, «Поставщик», «Продавец», «От кого», печать), buyer — кому («Покупатель», «Получатель», «Кому», «Клиент»); имя как написано, телефон, если есть; стороны не видно — null. fragment — true, если на фото только часть документа: нет шапки и нумерация строк начинается не с 1, или итог промежуточный («Итого по странице», перенос), или документ явно продолжается на другом листе. Для накладной извлеки дату, номер накладной, все позиции (номер строки, название как написано, количество, единицу, цену за единицу, сумму строки, уверенность 0-1 по каждой позиции), итог по бумаге (total_declared, если виден) и посчитанный тобой итог по сумме строк (total_computed). Валюта всегда KGS. Числа (qty, price, sum) — только с точкой как разделителем дробной части, без пробелов и разделителей тысяч, например "1234.50", никогда "1 234,50". Единицу измерения приводи к одному из: шт, м, кг, упак, л (если не подходит ни одна — оставь как есть). В рукописных накладных название часто пишут один раз, а в следующих строках — только размер или вариант (например «Щит -4», ниже «-8», «-12», или «Хомуты 150», ниже «200», «250») либо знак повтора (〃, -//-, «то же»). В таких строках пиши полное название, как если бы его повторили: «Щит - 8», «Хомуты 200». Если строка вызывает сомнение (зачёркнуто, неразборчиво) — опиши это в warnings. Отвечай только JSON по заданной схеме, ничего лишнего.`;

// Добавляется, только когда страниц больше одной — запрос для одного фото не меняется.
const multiPagePrompt = `Страниц несколько (несколько фото или PDF из нескольких страниц) — это страницы одной накладной по порядку. Объедини позиции всех страниц в один список со сквозной нумерацией n; если строка повторяется на стыке страниц (перенос), учти её один раз. Контрагент, дата, номер и итог по бумаге обычно на первой или последней странице.`;

const notebookPrompt = `Это страницы тетради долгов магазина стройматериалов в Кыргызстане (рукописная кириллица, кыргызские и узбекские имена). Нужен текущий долг каждого человека на сегодня: имя (как написано), телефон, если записан, и сумма в сомах. Если у человека несколько записей (долг, частичные оплаты, зачёркнутые суммы) — верни один итоговый остаток: зачёркнутое не считай, оплаты вычти. Сумма положительная — человек должен; отрицательная — аванс (заплатил больше, чем должен). Одно имя — одна строка. Уверенность 0-1 по каждой строке. Если что-то неразборчиво или неоднозначно — опиши в warnings. Отвечай только JSON по заданной схеме.`;

const receiptPrompt = `Ты распознаёшь чек или скриншот перевода банка MBank (Кыргызстан). Извлеки банк, номер операции, дату и время перевода (datetime — как на чеке, в формате ГГГГ-ММ-ДДTчч:мм, например 2026-09-26T14:35, без часового пояса), сумму, имя отправителя, имя и телефон получателя, назначение платежа, и уверенность 0-1. Отвечай только JSON по заданной схеме.`;

function estimateCost(raw: unknown): number | null {
  const usage = (
    raw as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    }
  )?.usageMetadata;
  if (!usage) return null;
  const priceIn = Number(process.env.GEMINI_PRICE_PER_1K_INPUT ?? "0.0003");
  const priceOut = Number(process.env.GEMINI_PRICE_PER_1K_OUTPUT ?? "0.0025");
  const input = (usage.promptTokenCount ?? 0) / 1000;
  // Токены рассуждения оплачиваются как выходные.
  const output = ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) / 1000;
  return Number((input * priceIn + output * priceOut).toFixed(4));
}

/**
 * Скорость и цена: по умолчанию Gemini 3 рассуждает на уровне high (токены
 * рассуждения оплачиваются как выходные и дают основную задержку), а фото
 * обрабатывает в высоком разрешении (1120 токенов). Для извлечения полей из
 * накладной достаточно low и medium (560 токенов) — по документации Google
 * качество распознавания документов на medium уже не растёт.
 * Настраивается через GEMINI_THINKING_LEVEL / GEMINI_MEDIA_RESOLUTION.
 */
function tuningConfig() {
  return {
    thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" },
    mediaResolution: process.env.GEMINI_MEDIA_RESOLUTION || "MEDIA_RESOLUTION_MEDIUM",
  };
}

async function callGemini(
  model: string,
  apiKey: string,
  prompt: string,
  schema: object,
  pages: PhotoPage[],
): Promise<{ json: unknown; raw: unknown }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const request = (tuned: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              ...pages.map((page) => ({
                inline_data: { mime_type: page.mimeType, data: page.photo.toString("base64") },
              })),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(tuned ? tuningConfig() : {}),
        },
      }),
    });
  let response = await request(true);
  if (response.status === 400) {
    // Модель из GEMINI_MODEL может не поддерживать уровень рассуждения или
    // разрешение — лучше распознать дороже, чем не распознать вовсе.
    const text = await response.text().catch(() => "");
    console.warn("callGemini: tuned request rejected, retrying without tuning", {
      model,
      error: text.slice(0, 300),
    });
    response = await request(false);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`gemini_http_${response.status}: ${text.slice(0, 300)}`);
  }
  const raw = await response.json();
  const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("gemini_empty_response");
  return { json: JSON.parse(text), raw };
}

export function createGeminiProvider(apiKey: string, model: string): RecognitionProvider {
  return {
    name: "gemini",
    model,
    async recognizeInvoice(pages): Promise<RawCall<InvoiceResult>> {
      // PDF сам может содержать несколько страниц — правило объединения нужно и ему.
      const multiPage = pages.length > 1 || pages.some((p) => p.mimeType === "application/pdf");
      const prompt = multiPage ? `${invoicePrompt}\n\n${multiPagePrompt}` : invoicePrompt;
      const { json, raw } = await callGemini(model, apiKey, prompt, invoiceSchema, pages);
      return { result: json as InvoiceResult, raw, costUsd: estimateCost(raw) };
    },
    async recognizeNotebook(pages): Promise<RawCall<NotebookResult>> {
      const { json, raw } = await callGemini(model, apiKey, notebookPrompt, notebookSchema, pages);
      return { result: json as NotebookResult, raw, costUsd: estimateCost(raw) };
    },
    async recognizeReceipt(photo, mimeType): Promise<RawCall<ReceiptResult>> {
      const { json, raw } = await callGemini(model, apiKey, receiptPrompt, receiptSchema, [
        { photo, mimeType },
      ]);
      return { result: json as ReceiptResult, raw, costUsd: estimateCost(raw) };
    },
  };
}
