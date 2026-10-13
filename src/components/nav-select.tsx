"use client";
import { useRouter } from "next/navigation";

export type NavOption = { label: string; href: string; selected?: boolean };

/**
 * Выпадающий список-переход: фильтр или сортировка списка. Выбрали —
 * сразу открываем адрес варианта, без кнопки «Применить».
 */
export function NavSelect({ label, options }: { label: string; options: NavOption[] }) {
  const router = useRouter();
  const current = options.find((o) => o.selected) ?? options[0];
  return (
    <label className="nav-select">
      <span className="nav-select-label">{label}</span>
      <select value={current?.href} onChange={(e) => router.push(e.target.value)}>
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Строка выпадающих списков под поиском. */
export function NavSelects({ children }: { children: React.ReactNode }) {
  return <div className="nav-selects">{children}</div>;
}
