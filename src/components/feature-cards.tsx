"use client";

import { useEffect, useState } from "react";
import type { Feature } from "@/lib/features";
import { FeatureSheet } from "./feature-sheet";
import { Icon } from "./icon";

/** Какие карточки «Что умеет Depter» человек уже открывал — в этом браузере, не в базе. */
const seenKey = (shopId: string) => `depter-features-seen-${shopId}`;

export function readSeen(shopId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(seenKey(shopId)) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Карточки возможностей и объяснение снизу экрана: зачем, шаги, бледный
 * пример и кнопка туда, где это делают. Закрыли объяснение — «✓ посмотрели».
 */
export function FeatureCards({ features, shopId, shopName }: { features: Feature[]; shopId: string; shopName: string }) {
  const [seen, setSeen] = useState<string[]>([]);
  const [open, setOpen] = useState<Feature | null>(null);

  useEffect(() => setSeen(readSeen(shopId)), [shopId]);

  const close = () => {
    if (open && !seen.includes(open.id)) {
      const next = [...seen, open.id];
      setSeen(next);
      try {
        localStorage.setItem(seenKey(shopId), JSON.stringify(next));
      } catch {}
    }
    setOpen(null);
  };

  const count = features.filter((f) => seen.includes(f.id)).length;
  return (
    <>
      {count > 0 && (
        <p className="muted">
          Посмотрели {count} из {features.length}
        </p>
      )}
      <div className="features-grid">
        {features.map((f) => (
          <button type="button" key={f.id} className="feature-card" onClick={() => setOpen(f)}>
            {seen.includes(f.id) && <span className="feature-seen">✓ посмотрели</span>}
            <span className="feature-icon">
              <Icon name={f.icon} />
            </span>
            <strong>{f.title}</strong>
            <small>{f.short}</small>
          </button>
        ))}
      </div>
      <FeatureSheet content={open} icon={open && <Icon name={open.icon} />} shopName={shopName} onClose={close} />
    </>
  );
}
