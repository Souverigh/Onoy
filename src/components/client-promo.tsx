"use client";

import { useEffect, useRef } from "react";
import { ContactLinks } from "./contact-links";
import { LogoMark } from "./logo-mark";

/**
 * Кружок Depter справа внизу на страницах для клиентов: нажали — карточка
 * «Напишите нам». hint — карточка сама открывается на пару секунд вскоре
 * после захода (раз в день в этом браузере), чтобы её заметили. raised — выше,
 * над нижней панелью «Мой список» каталога.
 */
export function ClientPromo({
  text,
  label,
  hint = false,
  raised = false,
}: {
  text: string;
  label: string;
  hint?: boolean;
  raised?: boolean;
}) {
  const box = useRef<HTMLDetailsElement>(null);
  // Человек сам открыл или закрыл — подсказку больше не трогаем.
  const touched = useRef(false);

  useEffect(() => {
    if (!hint) return;
    // Раз в день (просьба пользователя 23.10.2026): запоминаем дату показа.
    const key = "depter-promo-hint";
    const today = new Date().toLocaleDateString("sv-SE");
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      // Нет хранилища — подсказка покажется при каждом заходе, не страшно.
    }
    const show = setTimeout(() => {
      if (box.current && !touched.current) box.current.open = true;
    }, 1500);
    const hide = setTimeout(() => {
      if (box.current && !touched.current) box.current.open = false;
    }, 4500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [hint]);

  return (
    <details ref={box} className={raised ? "client-promo client-promo-raised" : "client-promo"}>
      <summary aria-label={label} onClick={() => (touched.current = true)}>
        <LogoMark size={26} />
      </summary>
      <div className="client-promo-card">
        <p>{text}</p>
        <ContactLinks />
      </div>
    </details>
  );
}
