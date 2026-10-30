"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon } from "./icon";
import { TeachExample, TeachSteps, type ExampleRow } from "./teach";

/** Что показать в объяснении: зачем, шаги, бледный пример и куда перейти. */
export type SheetContent = {
  title: string;
  text: string;
  steps: readonly string[];
  rows: readonly ExampleRow[];
  message?: string;
  button: { label: string; href: string };
};

/**
 * Объяснение снизу экрана (на компьютере — окном по центру): «Что умеет
 * Depter» и «Первые шаги». Ничего не записывает — только кнопка туда, где
 * это делают. Esc, крестик или нажатие мимо — закрыть.
 */
export function FeatureSheet({
  content,
  icon,
  onClose,
}: {
  content: SheetContent | null;
  icon: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = content !== null;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute("open", "");
      }
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="feature-sheet"
      aria-labelledby="feature-sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Нажатие на затемнение вокруг — закрыть.
        if (e.target === dialog.current) onClose();
      }}
    >
      {content && (
        <>
          <div className="feature-sheet-grip" aria-hidden="true" />
          <div className="feature-sheet-head">
            <span className="feature-icon">{icon}</span>
            <h2 id="feature-sheet-title">{content.title}</h2>
            <button type="button" className="feature-sheet-close" aria-label="Закрыть" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          <div className="teach">
            <p>{content.text}</p>
            <TeachSteps steps={content.steps} />
            <TeachExample rows={content.rows} message={content.message} />
            <div className="teach-actions">
              <Link className="button primary" href={content.button.href} onClick={onClose}>
                {content.button.label}
              </Link>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
