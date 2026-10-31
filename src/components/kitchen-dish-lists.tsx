"use client";

import { useState } from "react";
import { money, quantity } from "@/lib/format";
import type { ItemStat } from "@/lib/kitchen-stats";

type List = "profit" | "popular" | "bad";

/**
 * Три списка блюд (макет 31.10.2026): «Больше всего заработали», «Продают
 * чаще всего», «Невыгодные». Компьютер — три карточки по 3 строки рядом;
 * телефон — переключатель и один список целиком.
 */
export function DishLists({ items, currency, limit }: { items: ItemStat[]; currency: string; limit: number }) {
  const [list, setList] = useState<List>("profit");
  const lists: Record<List, ItemStat[]> = {
    profit: items.filter((i) => i.profit !== null).sort((a, b) => b.profit! - a.profit!),
    popular: [...items].sort((a, b) => b.qty - a.qty),
    // Товары (Fanta, нан) перепродают с небольшой наценкой — порог блюд к ним не подходит.
    bad: items.filter((i) => i.kind === "dish" && i.share !== null && i.share > limit).sort((a, b) => b.share! - a.share!),
  };
  const value = (kind: List, i: ItemStat) =>
    kind === "popular" ? `${quantity(i.qty)} шт` : kind === "bad" ? `${i.share}%` : `+${money(i.profit!, currency)}`;
  const titles: Record<List, string> = { profit: "Больше всего заработали", popular: "Продают чаще всего", bad: "Невыгодные" };

  return (
    <>
      <div className="kr-three">
        {(["profit", "popular", "bad"] as const).map((kind) => (
          <section key={kind} className={kind === "bad" ? "panel kr-top bad" : "panel kr-top"}>
            <h3>{titles[kind]}</h3>
            {lists[kind].slice(0, 3).map((i) => (
              <p key={`${i.kind}:${i.id}`}>
                <span>{i.name}</span>
                <b>{value(kind, i)}</b>
              </p>
            ))}
            {!lists[kind].length && <p className="muted">{kind === "bad" ? "Нет - все блюда выгодные." : "Пока нет данных."}</p>}
            {kind === "bad" && lists.bad.length > 0 && <p className="muted kr-top-note">продукты дороже {limit}% цены</p>}
          </section>
        ))}
      </div>

      <div className="kr-phone">
        <div className="kr-seg" role="group" aria-label="Список">
          {(["profit", "popular", "bad"] as const).map((kind) => (
            <button key={kind} type="button" className={list === kind ? "on" : undefined} aria-pressed={list === kind} onClick={() => setList(kind)}>
              {kind === "profit" ? "Заработали" : kind === "popular" ? "Продают" : `Невыгодные${lists.bad.length ? ` ${lists.bad.length}` : ""}`}
            </button>
          ))}
        </div>
        <section className="panel kr-list">
          {lists[list].map((i) => (
            <p key={`${i.kind}:${i.id}`}>
              <span>
                {i.name}
                <small>
                  {quantity(i.qty)} шт{i.share !== null ? ` · продукты ${i.share}%` : ""}
                </small>
              </span>
              <b className={list === "bad" || (i.kind === "dish" && i.share !== null && i.share > limit) ? "kr-loss" : undefined}>
                {list === "popular" ? `${quantity(i.qty)} шт` : i.profit === null ? "-" : `${i.profit >= 0 ? "+" : ""}${money(i.profit, currency)}`}
              </b>
            </p>
          ))}
          {!lists[list].length && <p className="muted">{list === "bad" ? "Нет - все блюда выгодные." : "Пока нет данных."}</p>}
        </section>
      </div>
    </>
  );
}
