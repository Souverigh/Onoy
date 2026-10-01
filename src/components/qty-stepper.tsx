"use client";

import { useState } from "react";
import { stockNumber } from "@/lib/stock";

/**
 * Поле количества для обычной формы (name уходит в FormData): любое число
 * вручную (12,5), по бокам − и + на единицу. Ниже нуля не опускается.
 */
export function QtyStepper({
  name,
  label,
  required = false,
  defaultValue = "",
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const step = (delta: number) => {
    const current = Number(stockNumber(value || "0", 3) ?? 0);
    const next = Math.max(0, Math.round((current + delta) * 1000) / 1000);
    setValue(next ? String(next).replace(".", ",") : "");
  };
  return (
    <span className="qty-stepper qty-stepper-wide">
      <button type="button" aria-label="Меньше" onClick={() => step(-1)}>
        −
      </button>
      <input
        name={name}
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        placeholder="0"
        required={required}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" aria-label="Больше" onClick={() => step(1)}>
        +
      </button>
    </span>
  );
}
