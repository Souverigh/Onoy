"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Значок «!» рядом с полем: по нажатию — пояснение во всплывающем окошке.
 * Вместо строк серого текста под полями.
 */
export function InfoTip({ children, label = "Подсказка" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span className="info-tip" ref={box}>
      <button
        type="button"
        className={`info-tip-button${open ? " active" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          // Внутри <label> — не переключать поле.
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        !
      </button>
      {open && (
        <span className="info-tip-popover" id={id} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}
