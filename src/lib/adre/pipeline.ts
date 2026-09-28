import "server-only";
import type { InvoiceResult, PhotoPage, RawCall, RecognitionProvider } from "./types";
import { isImage, pageHalves, uprightPage } from "./image";
import { mergeHalves } from "./halves";
import { normalizeInvoiceResult } from "./normalize";
import { reconcileInvoice } from "./reconcile";

/** ТЗ §15.5: документ длиннее 25 строк распознавать по половинам. */
export const LONG_DOCUMENT_LINES = 25;

/**
 * Чем меньше, тем лучше: строки, где не сошлась арифметика, и расхождение
 * итога по строкам с «Итого» на бумаге (оно весит как несколько строк).
 */
function readingScore(result: InvoiceResult): number {
  const check = reconcileInvoice(result, null);
  return check.badLines.length + (check.paperMismatch ? 3 : 0);
}

/**
 * Распознавание накладной с поправками (ТЗ §15.5 P0):
 * 1. Фото боком или вверх ногами — модель сама говорит, где верх документа
 *    (top_side); поворачиваем и распознаём ещё раз. Прямые фото — один вызов.
 * 2. Длинная страница (> 25 строк), где не сошлись строки или итог, —
 *    распознаём верхнюю и нижнюю половины отдельно, склеиваем и берём этот
 *    вариант, только если он сходится лучше.
 * Только для одного фото: PDF и многостраничные накладные — как раньше.
 * Любая ошибка поправки оставляет первый результат.
 */
export async function recognizeInvoicePages(
  provider: RecognitionProvider,
  pages: PhotoPage[],
): Promise<RawCall<InvoiceResult>> {
  const responses: unknown[] = [];
  let cost = 0;
  let costKnown = true;
  const call = async (input: PhotoPage[], part?: "upper" | "lower") => {
    const response = await provider.recognizeInvoice(input, part);
    responses.push(response.raw);
    if (response.costUsd == null) costKnown = false;
    else cost += response.costUsd;
    return response.result;
  };

  let result = await call(pages);
  const processing: NonNullable<InvoiceResult["processing"]> = {};
  const single = pages.length === 1 && isImage(pages[0]);
  let page = pages[0];

  if (single && result.top_side && result.top_side !== "top") {
    try {
      const upright = await uprightPage(page, result.top_side);
      const again = await call([upright]);
      processing.rotated = result.top_side;
      result = again;
      page = upright;
    } catch (error) {
      console.error("recognizeInvoicePages: rotation failed", error);
    }
  }

  if (single && (result.document_class ?? "invoice") === "invoice") {
    const whole = normalizeInvoiceResult(result);
    if (whole.lines.length > LONG_DOCUMENT_LINES && readingScore(whole) > 0) {
      try {
        const [upper, lower] = await pageHalves(page);
        const [top, bottom] = await Promise.all([call([upper], "upper"), call([lower], "lower")]);
        const lines = mergeHalves(normalizeInvoiceResult(top).lines, normalizeInvoiceResult(bottom).lines);
        const byHalves = normalizeInvoiceResult({ ...result, lines });
        if (readingScore(byHalves) < readingScore(whole)) {
          result = { ...result, lines: byHalves.lines };
          processing.halves = true;
        }
      } catch (error) {
        console.error("recognizeInvoicePages: halves failed", error);
      }
    }
  }

  return {
    result: { ...result, processing },
    raw: responses.length === 1 ? responses[0] : { responses },
    costUsd: costKnown ? Number(cost.toFixed(4)) : null,
  };
}
