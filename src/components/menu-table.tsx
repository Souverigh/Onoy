import Link from "next/link";
import { money } from "@/lib/format";
import { SHARE_LIMITS, shareLevel } from "@/lib/dish";
import type { MenuDish } from "@/lib/dish-data";
import { plural } from "./dashboard";

const dishWord = (n: number) => `${n} ${plural(n, "блюдо", "блюда", "блюд")}`;

/**
 * Сводка меню (макет 31.10.2026): на компьютере — четыре плашки, на
 * телефоне — одна строка про невыгодные блюда.
 */
export function MenuStats({ dishes }: { dishes: MenuDish[] }) {
  const withShare = dishes.filter((d) => d.share !== null);
  const bad = withShare.filter((d) => shareLevel(d.share!) === "bad").length;
  const empty = dishes.filter((d) => !d.lines.length).length;
  const average = withShare.length ? Math.round(withShare.reduce((s, d) => s + d.share!, 0) / withShare.length) : null;
  return (
    <>
      <div className="menu-stats">
        <div>
          <span>Блюд в меню</span>
          <b>{dishes.length}</b>
        </div>
        <div>
          <span>Продукты в среднем</span>
          <b>{average === null ? "-" : `${average}% от цены`}</b>
        </div>
        <div className={bad ? "warn" : undefined}>
          <span>Невыгодные (продукты дороже {SHARE_LIMITS.high}%)</span>
          <b>{bad ? dishWord(bad) : "нет"}</b>
        </div>
        <div className={empty ? "warn" : undefined}>
          <span>Без состава</span>
          <b>{empty ? dishWord(empty) : "нет"}</b>
        </div>
      </div>
      {bad > 0 && (
        <p className="notice menu-alert">
          <b>{dishWord(bad)}</b> {bad === 1 ? "невыгодно" : "невыгодны"}: продукты дороже {SHARE_LIMITS.high}% цены.
        </p>
      )}
    </>
  );
}

/**
 * Блюда по категориям: цена, продукты на порцию, заработок и доля продуктов.
 * Таблица на компьютере, карточки на телефоне — одна разметка, раскладку
 * меняет CSS (.menu-*).
 */
export function MenuTable({ dishes, currency }: { dishes: MenuDish[]; currency: string }) {
  const groups = new Map<string, MenuDish[]>();
  const sorted = [...dishes].sort(
    (a, b) => (a.category ?? "￿").localeCompare(b.category ?? "￿", "ru") || a.name.localeCompare(b.name, "ru"),
  );
  for (const d of sorted) groups.set(d.category ?? "Без категории", [...(groups.get(d.category ?? "Без категории") ?? []), d]);
  const gain = (d: MenuDish) => Math.round((Number(d.price) - d.cost) * 100) / 100;

  return (
    <section className="menu-table">
      <div className="menu-row menu-head" aria-hidden="true">
        <span>Блюдо</span>
        <span className="menu-price">Цена</span>
        <span className="menu-cost">Продукты</span>
        <span className="menu-gain">Заработок</span>
        <span className="menu-share">Доля продуктов</span>
      </div>
      {[...groups.entries()].map(([category, list]) => (
        <div key={category} className="menu-group">
          <p className="menu-category">{category}</p>
          {list.map((d) => {
            const level = d.share === null ? null : shareLevel(d.share);
            const priced = d.lines.length > 0 && Number(d.price) > 0;
            return (
              <Link key={d.id} href={`/menu/${d.id}`} className="menu-row">
                <span className="menu-name">
                  {d.name}
                  <small className={d.lines.length ? undefined : "menu-empty"}>
                    {d.lines.length ? `продукты ${money(d.cost, currency)}` : "нет состава - нажмите, чтобы добавить"}
                  </small>
                </span>
                <span className="menu-price">
                  {money(d.price, currency)}
                  {priced && (
                    <small className={level ?? undefined}>
                      +{money(gain(d), currency)}
                      {level && level !== "ok" ? ` · ${d.share}%` : ""}
                    </small>
                  )}
                </span>
                <span className="menu-cost">{d.lines.length ? money(d.cost, currency) : ""}</span>
                <span className="menu-gain">{priced ? `+${money(gain(d), currency)}` : ""}</span>
                <span className="menu-share">
                  {d.share !== null && level ? (
                    <>
                      <span className={`menu-bar ${level}`}>
                        <i style={{ width: `${Math.min(d.share, 100)}%` }} />
                      </span>
                      <b className={level}>{d.share}%</b>
                    </>
                  ) : !d.lines.length ? (
                    <span className="menu-empty">нет состава - добавить</span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
