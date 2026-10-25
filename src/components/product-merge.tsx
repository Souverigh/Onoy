"use client";

import { useState } from "react";
import { mergeProducts } from "@/app/(workspace)/stock/actions";
import { searchProducts } from "@/lib/match";
import { ConfirmButton } from "./confirm-button";
import { InfoTip } from "./info-tip";

type Other = { id: string; name: string; sku: string | null; aliases: string[] | null };

/**
 * «Дубль? Объединить с…» (просьба пользователя 26.10.2026): приход по фото
 * заводил второй товар с кодом в названии. Владелец находит настоящий товар —
 * остаток, продажи, приходы и возвраты дубля переходят к нему, название
 * дубля становится синонимом, дубль уходит в архив; отмена — в течение суток.
 */
export function ProductMerge({ id, name, others }: { id: string; name: string; others: Other[] }) {
  const [query, setQuery] = useState("");
  const [into, setInto] = useState<Other | null>(null);
  const found = query.trim() ? searchProducts(query, others, 6) : [];
  return (
    <form action={mergeProducts} className="product-merge">
      <input type="hidden" name="id" value={id} />
      {into && <input type="hidden" name="into" value={into.id} />}
      <span className="label-with-tip">
        Дубль? Объединить с другим товаром
        <InfoTip>
          Остаток, продажи, приходы и возвраты «{name}» перейдут к выбранному товару, название «{name}» станет его
          другим названием, этот товар уйдёт в архив. Отменить можно в течение суток.
        </InfoTip>
      </span>
      {into ? (
        <p className="product-merge-picked">
          <span>
            С товаром <strong>{into.name}</strong>
            {into.sku ? <small className="muted"> · код {into.sku}</small> : null}
          </span>
          <button type="button" className="text-button" onClick={() => setInto(null)}>
            Другой
          </button>
        </p>
      ) : (
        <>
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Найти товар, с которым объединить"
            placeholder="Найти товар: название или код"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (found[0]) setInto(found[0]);
              }
            }}
          />
          {found.length > 0 && (
            <ul className="product-results">
              {found.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setInto(p)}>
                    <span className="product-result-name">{p.name}</span>
                    {p.sku && <small className="muted">{p.sku}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {into && (
        <ConfirmButton
          className="button"
          danger={false}
          confirmLabel="Да, объединить"
          message={`Объединить «${name}» с «${into.name}»?`}
          text={`Остаток, продажи, приходы и возвраты перейдут к «${into.name}», «${name}» уйдёт в архив. Отменить можно в течение суток.`}
        >
          Объединить
        </ConfirmButton>
      )}
    </form>
  );
}
