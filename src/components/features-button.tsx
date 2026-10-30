"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readSeen } from "./feature-cards";
import { Icon, type IconName } from "./icon";

/**
 * «Что умеет Depter» на главной нового магазина (вариант А, 29.10.2026):
 * заметная плашка на экран /features — значки того, что внутри, и кнопка
 * «Смотреть». Посмотрели всё — один раз «Вы посмотрели всё», потом её нет.
 */
export function FeaturesButton({ shopId, icons }: { shopId: string; icons: IconName[] }) {
  const total = icons.length;
  const [seen, setSeen] = useState(0);
  const [hidden, setHidden] = useState(false);
  const doneKey = `depter-features-done-${shopId}`;

  useEffect(() => {
    const count = readSeen(shopId).length;
    setSeen(count);
    if (count < total) return;
    try {
      if (localStorage.getItem(doneKey) === "1") setHidden(true);
      else localStorage.setItem(doneKey, "1");
    } catch {}
  }, [shopId, total, doneKey]);

  if (hidden) return null;
  const all = seen >= total;
  return (
    <Link className="features-cta" href="/features">
      <span className="features-cta-icon">
        <Icon name="bulb" />
      </span>
      <span className="features-cta-text">
        <strong>{all ? "Вы посмотрели всё" : "Что умеет Depter"}</strong>
        {all ? (
          <small>Захотите вспомнить - экран останется в «Что нового»</small>
        ) : seen > 0 ? (
          <small>
            Посмотрели {seen} из {total}
          </small>
        ) : (
          <span className="features-cta-icons" aria-label={`${total} возможностей`}>
            {icons.slice(0, 4).map((name) => (
              <span key={name} aria-hidden="true">
                <Icon name={name} />
              </span>
            ))}
            {total > 4 && <small aria-hidden="true">и ещё {total - 4}</small>}
          </span>
        )}
      </span>
      <span className="features-cta-go">Смотреть</span>
    </Link>
  );
}
