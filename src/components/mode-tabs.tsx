"use client";

import Link from "next/link";

export type SaleMode = "photo" | "items" | "amount";

/**
 * «Фото» / «Склад» (задача 10) / «Сумма» (28.10.2026 — было переключателем
 * «Без накладной» внутри фото; подписи одним словом — просьба пользователя).
 * «Склад» — только с модулем склада. Выбор запоминается на этом телефоне —
 * в следующий раз форма откроется там же.
 */
export function ModeTabs({
  kind,
  selected,
  party,
  stock,
}: {
  kind: "sale" | "purchase";
  selected: SaleMode;
  party?: string;
  stock: boolean;
}) {
  const remember = (mode: SaleMode) => {
    document.cookie = `mode_${kind}=${mode}; path=/money; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };
  const href = (mode: SaleMode) => `/money/new?type=${kind}&mode=${mode}${party ? `&party=${party}` : ""}`;
  const tabs: [SaleMode, string][] = [
    ["photo", "Фото"],
    ...(stock ? [["items", "Склад"] as [SaleMode, string]] : []),
    ["amount", "Сумма"],
  ];
  return (
    <nav className="tabs sale-mode-tabs" aria-label={kind === "sale" ? "Как оформить продажу" : "Как оформить товар от поставщика"}>
      {tabs.map(([mode, label]) => (
        <Link key={mode} className={selected === mode ? "selected" : ""} href={href(mode)} onClick={() => remember(mode)}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
