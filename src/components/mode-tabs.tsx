"use client";

import Link from "next/link";

/**
 * «По фото накладной» / «Товары со склада» (задача 10). Выбор запоминается
 * на этом телефоне — в следующий раз форма откроется там же.
 */
export function ModeTabs({
  kind,
  selected,
  party,
}: {
  kind: "sale" | "purchase";
  selected: "photo" | "items";
  party?: string;
}) {
  const remember = (mode: "photo" | "items") => {
    document.cookie = `mode_${kind}=${mode}; path=/money; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };
  const href = (mode: "photo" | "items") => `/money/new?type=${kind}&mode=${mode}${party ? `&party=${party}` : ""}`;
  return (
    <nav className="tabs sale-mode-tabs" aria-label={kind === "sale" ? "Как оформить продажу" : "Как оформить товар от поставщика"}>
      <Link className={selected === "photo" ? "selected" : ""} href={href("photo")} onClick={() => remember("photo")}>
        По фото накладной
      </Link>
      <Link className={selected === "items" ? "selected" : ""} href={href("items")} onClick={() => remember("items")}>
        {kind === "sale" ? "Товары со склада" : "Товары на склад"}
      </Link>
    </nav>
  );
}
