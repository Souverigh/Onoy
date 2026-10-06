"use client";

import { useEffect, useId, useRef, useState } from "react";
import { debtMoney, phoneText } from "@/lib/format";
import { partyCurrency, type Currency } from "@/lib/currency";
import { searchParties } from "@/lib/party-search";

export type PickerParty = {
  id: string;
  name: string;
  phone?: string | null;
  aliases?: string[] | null;
  balance?: string;
  currency?: string | null;
};

/**
 * Выбор клиента или поставщика поиском по имени и телефону (задача 12)
 * вместо длинного списка. Выбранный — карточкой с долгом и «Изменить».
 */
export function PartyPicker({
  label,
  name,
  parties,
  value,
  onChange,
  shopCurrency,
  placeholder,
  footer,
  actions,
}: {
  label: string;
  /** Имя поля формы с id выбранного. */
  name: string;
  parties: PickerParty[];
  value: string;
  onChange: (id: string) => void;
  shopCurrency: Currency;
  placeholder?: string;
  /** Под списком: «+ Новый клиент». */
  footer?: React.ReactNode;
  /**
   * Первые пункты выпадающего списка, выделены: «+ Новый клиент»,
   * «Из контактов». `close` — закрыть список.
   */
  actions?: (close: () => void) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  // Нажатие мимо поля и списка закрывает список.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const selected = parties.find((p) => p.id === value);
  const found = searchParties(query, parties, actions ? 100 : 8);

  if (selected)
    return (
      <div className="party-picker">
        <span className="party-picker-label">{label}</span>
        <input type="hidden" name={name} value={selected.id} />
        <div className="party-picked">
          <span>
            <strong>{selected.name}</strong>
            <small className="muted">
              {[
                selected.phone ? phoneText(selected.phone) : null,
                selected.balance != null ? `долг ${debtMoney(selected.balance, partyCurrency(selected, shopCurrency))}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </span>
          <button
            type="button"
            className="button"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
            }}
          >
            Изменить
          </button>
        </div>
      </div>
    );

  return (
    <div className="party-picker" ref={box}>
      <label className="party-picker-label" htmlFor={`${listId}-q`}>
        {label}
      </label>
      <input type="hidden" name={name} value="" />
      <input
        id={`${listId}-q`}
        className="party-picker-search"
        type="search"
        autoComplete="off"
        placeholder={placeholder ?? "Имя или телефон…"}
        value={query}
        aria-controls={listId}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // Enter — выбрать первого найденного, а не отправить форму.
          if (e.key === "Enter") {
            e.preventDefault();
            if (found[0]) onChange(found[0].id);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul className={`party-picker-list${actions ? " dropdown" : ""}`} id={listId} role="listbox">
          {actions && <li className="party-picker-actions">{actions(() => setOpen(false))}</li>}
          {found.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => onChange(p.id)}>
                <span>{p.name}</span>
                <small className="muted">
                  {[
                    p.phone ? phoneText(p.phone) : null,
                    p.balance != null && Number(p.balance) !== 0
                      ? debtMoney(p.balance, partyCurrency(p, shopCurrency))
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            </li>
          ))}
          {found.length === 0 && <li className="muted party-picker-empty">Никого не нашли.</li>}
        </ul>
      )}
      {footer}
    </div>
  );
}
