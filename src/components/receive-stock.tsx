"use client";

import { useState } from "react";
import { receivePurchase } from "@/app/(workspace)/stock/actions";
import { Submit } from "./submit";
import { money, quantity } from "@/lib/format";
import { PRODUCT_UNITS } from "@/lib/stock";

export type ReceiveLine = {
  id: string;
  n: number;
  name: string;
  qty: string;
  /** Единица со строки, уже приведённая к нашей (normalizeUnit); null — не узнали. */
  unit: string | null;
  rawUnit: string;
  price: string;
  /** Похожие товары склада, лучший — первым. */
  matches: { id: string; name: string; unit: string; score: number }[];
};

type Choice = { include: boolean; product: string; unit: string; salePrice: string };

/** Совпало почти целиком — выбираем товар сами, иначе по умолчанию «новый». */
const SURE = 0.85;

/**
 * «Принять на склад» по распознанной накладной прихода: каждая строка —
 * существующий товар (похожие предложены) или новый. Остатки вырастут,
 * название со строки запомнится синонимом товара.
 */
export function ReceiveStock({
  purchaseId,
  documentId,
  lines,
  currency,
}: {
  purchaseId: string;
  documentId: string;
  lines: ReceiveLine[];
  currency: string;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        {
          include: Number(line.qty) > 0 && Number(line.price) >= 0,
          product: line.matches[0] && line.matches[0].score >= SURE ? line.matches[0].id : "",
          unit: line.unit ?? "шт",
          salePrice: "",
        },
      ]),
    ),
  );
  const set = (id: string, patch: Partial<Choice>) => setChoices((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const chosen = lines.filter((line) => choices[line.id].include);
  const items = chosen.map((line) => {
    const c = choices[line.id];
    return c.product
      ? { line: line.id, product: c.product }
      : { line: line.id, unit: c.unit, sale_price: c.salePrice.trim() || undefined };
  });
  const newCount = chosen.filter((line) => !choices[line.id].product).length;

  return (
    <form action={receivePurchase} className="receive-stock">
      <input type="hidden" name="purchase_id" value={purchaseId} />
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <ol className="receive-lines">
        {lines.map((line) => {
          const c = choices[line.id];
          return (
            <li key={line.id} className={c.include ? "receive-line" : "receive-line off"}>
              <label className="receive-line-head">
                <input type="checkbox" checked={c.include} onChange={(e) => set(line.id, { include: e.target.checked })} />
                <span>
                  <strong>{line.name}</strong>
                  <small className="muted">
                    {" "}
                    +{quantity(line.qty)} {line.unit ?? line.rawUnit} · закупка {money(line.price, currency)}
                  </small>
                </span>
              </label>
              {c.include && (
                <div className="receive-line-body">
                  <label>
                    Товар на складе
                    <select value={c.product} onChange={(e) => set(line.id, { product: e.target.value })}>
                      <option value="">Новый товар</option>
                      {line.matches.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.unit})
                        </option>
                      ))}
                    </select>
                  </label>
                  {!c.product && (
                    <div className="product-create-row">
                      <label>
                        Единица
                        <select value={c.unit} onChange={(e) => set(line.id, { unit: e.target.value })}>
                          {PRODUCT_UNITS.map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Цена продажи
                        <input
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Можно позже"
                          value={c.salePrice}
                          onChange={(e) => set(line.id, { salePrice: e.target.value })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="simple-operation-actions">
        <Submit disabled={chosen.length === 0}>
          {chosen.length ? `Принять на склад: ${chosen.length}` : "Отметьте строки"}
        </Submit>
      </div>
      {newCount > 0 && (
        <p className="operation-hint">
          Новых товаров: {newCount} - появятся в «Складе» с ценой закупки из накладной.
        </p>
      )}
    </form>
  );
}
