"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Значок «!» рядом с полем: по нажатию — пояснение во всплывающем окошке.
 * Вместо строк серого текста под полями.
 */
export function InfoTip({ children, label = "Подсказка" }: { children: React.ReactNode; label?: string }) {
  // Место окошка на экране: под значком, но не за краями экрана (телефон).
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const open = place !== null;
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  function show() {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 16;
    const width = Math.min(260, window.innerWidth - gutter * 2);
    const left = Math.min(Math.max(rect.left - 12, gutter), window.innerWidth - width - gutter);
    setPlace({ top: rect.bottom + 8, left, width });
  }
  const setOpen = (value: boolean) => (value ? show() : setPlace(null));

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Окошко стоит на месте экрана — при прокрутке закрываем.
    const close = () => setPlace(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className="info-tip" ref={box}>
      <button
        ref={button}
        type="button"
        className={`info-tip-button${open ? " active" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          // Внутри <label> — не переключать поле.
          e.preventDefault();
          setOpen(!open);
        }}
      >
        !
      </button>
      {place && (
        <span className="info-tip-popover" id={id} role="tooltip" style={place}>
          {children}
        </span>
      )}
    </span>
  );
}
