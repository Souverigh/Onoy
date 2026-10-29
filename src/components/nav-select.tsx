"use client";
import { useId } from "react";
import { useRouter } from "next/navigation";

export type NavOption = { label: string; href: string; selected?: boolean };

/**
 * Выпадающий список-переход: фильтр или сортировка списка. Выбрали —
 * сразу открываем адрес варианта, без кнопки «Применить». `tip` — значок
 * «!» рядом с подписью (не отдельной строкой).
 */
export function NavSelect({
  label,
  options,
  tip,
  icon,
  className,
}: {
  label: string;
  options: NavOption[];
  tip?: React.ReactNode;
  /** Значок внутри поля слева; подпись тогда только для экранного диктора (макет 29.10.2026). */
  icon?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const id = useId();
  const current = options.find((o) => o.selected) ?? options[0];
  return (
    <div className={`nav-select${icon ? " nav-select-icon" : ""}${className ? ` ${className}` : ""}`}>
      <span className={icon ? "sr-only" : "nav-select-label"}>
        <label htmlFor={id}>{label}</label>
        {tip}
      </span>
      {icon && (
        <span className="nav-select-glyph" aria-hidden="true">
          {icon}
        </span>
      )}
      <select id={id} value={current?.href} onChange={(e) => router.push(e.target.value)}>
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Строка выпадающих списков под поиском. */
export function NavSelects({ children }: { children: React.ReactNode }) {
  return <div className="nav-selects">{children}</div>;
}
