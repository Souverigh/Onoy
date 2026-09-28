import "server-only";
import type { InvoiceResult, PhotoPage, RawCall, RecognitionProvider } from "./types";
import { isImage, pageHalves, uprightPage } from "./image";
import { mergeHalves } from "./halves";
import { normalizeInvoiceResult } from "./normalize";
import { reconcileInvoice } from "./reconcile";

/** ТЗ §15.5: документ длиннее 25 строк распознавать по половинам. */
export const LONG_DOCUMENT_LINES = 25;

/**
 * Сколько раз поправлять поворот. На странице без шапки (продолжение
 * накладной) модель видит, что текст боком, но иногда путает сторону;
 * после поворота она говорит, что страница всё ещё кривая, — второй круг
 * это исправляет (замеры 28.09.2026 в handover, п. 55).
 */
const ROTATION_ROUNDS = 2;

/** Номера страниц (с 0), которые модель видит не прямыми; [] — все прямые или не понять. */
function crookedPages(result: InvoiceResult, pages: PhotoPage[]): number[] {
  const sides = result.page_top_sides;
  if (!pages.every(isImage) || sides?.length !== pages.length) return [];
  return sides.flatMap((side, i) => (side !== "top" ? [i] : []));
}

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
 * 1. Фото боком или вверх ногами — модель сама говорит, где верх документа на
 *    каждом фото (page_top_sides); поворачиваем только кривые и распознаём
 *    набор ещё раз. Прямые фото — один вызов.
 * 2. Длинная страница (> 25 строк), где не сошлись строки или итог, —
 *    распознаём верхнюю и нижнюю половины отдельно, склеиваем и берём этот
 *    вариант, только если он сходится лучше.
 * Поворот — если все страницы фото (не PDF); половины — только одно фото.
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

  const first = await call(pages);
  const processing: NonNullable<InvoiceResult["processing"]> = {};
  const single = pages.length === 1 && isImage(pages[0]);

  // Поворот по страницам: только фото и только если модель назвала верх
  // для каждого — иначе номера не сопоставить (у PDF внутри свои страницы).
  // Из всех попыток берём ту, где все страницы прямые и лучше сходится.
  type Attempt = { result: InvoiceResult; pages: PhotoPage[]; rotated: Set<number> };
  const attempts: Attempt[] = [{ result: first, pages, rotated: new Set() }];
  for (let round = 0; round < ROTATION_ROUNDS; round++) {
    const last = attempts[attempts.length - 1];
    const turn = crookedPages(last.result, last.pages);
    if (!turn.length) break;
    try {
      const sides = last.result.page_top_sides!;
      const upright = await Promise.all(
        last.pages.map((p, i) => (turn.includes(i) ? uprightPage(p, sides[i]) : p)),
      );
      attempts.push({
        result: await call(upright),
        pages: upright,
        rotated: new Set([...last.rotated, ...turn]),
      });
    } catch (error) {
      console.error("recognizeInvoicePages: rotation failed", error);
      break;
    }
  }
  const rank = (a: Attempt) =>
    (crookedPages(a.result, a.pages).length ? 1000 : 0) + readingScore(normalizeInvoiceResult(a.result));
  // При равенстве — более поздняя попытка (фото уже повёрнуто).
  const best = attempts.reduce((acc, a) => (rank(a) <= rank(acc) ? a : acc));
  let result = best.result;
  let page = best.pages[0];
  if (best.rotated.size) processing.rotatedPages = [...best.rotated].sort((a, b) => a - b).map((i) => i + 1);

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
