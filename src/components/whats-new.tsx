"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { NewsEntry } from "@/lib/changelog";

/** Номер последней просмотренной записи «Что нового» — в браузере человека. */
export const NEWS_SEEN_KEY = "depter-news-seen";

export function readNewsSeen(): number | null {
  try {
    const raw = localStorage.getItem(NEWS_SEEN_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    // Приватный режим — как будто не видел.
    return null;
  }
}

export function saveNewsSeen(n: number) {
  try {
    localStorage.setItem(NEWS_SEEN_KEY, String(n));
  } catch {
    // Не сохранилось — окно покажется ещё раз, данные не страдают.
  }
}

/** Сколько записей в окне; остальные — в разделе «Что нового». */
const SHOWN = 3;

/**
 * Окно «Что нового» на главной после обновления: новое с прошлого раза,
 * «Понятно» — закрыть и больше не показывать, пока не выйдет следующее.
 */
export function WhatsNewDialog({ entries, onClose }: { entries: NewsEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog news-dialog"
      aria-labelledby="news-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="confirm-dialog-body">
        <span className="eyebrow">ЧТО НОВОГО В DEPTER</span>
        <h2 id="news-dialog-title">{entries.length === 1 ? entries[0].title : "Мы обновили приложение"}</h2>
        <ul className="news-list">
          {entries.slice(0, SHOWN).map((e) => (
            <li key={e.n}>
              {entries.length > 1 && <strong>{e.title}</strong>}
              <p>{e.text}</p>
              {e.link && (
                <Link className="text-button" href={e.link.href} onClick={onClose}>
                  {e.link.label} →
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="confirm-dialog-actions">
          <button type="button" className="button primary" onClick={onClose}>
            Понятно
          </button>
          {entries.length > SHOWN && (
            <Link className="button" href="/news" onClick={onClose}>
              Ещё {entries.length - SHOWN}
            </Link>
          )}
        </div>
      </div>
    </dialog>
  );
}
