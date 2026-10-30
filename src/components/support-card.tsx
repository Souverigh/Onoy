"use client";

import { useEffect, useState } from "react";
import { WhatsAppIcon } from "./contact-links";
import { Icon } from "./icon";

/**
 * Поддержка в WhatsApp карточкой (просьба пользователя 30.10.2026): на главной
 * нового магазина — «Поможем начать» с крестиком (закрыли — больше не
 * показываем на этом устройстве), в «Помощи» — без крестика.
 */
export function SupportCard({
  title,
  text,
  href,
  hideKey,
}: {
  title: string;
  text: string;
  /** supportHref: WhatsApp с готовым текстом. */
  href: string;
  /** Ключ в браузере для «закрыли»; нет — крестика нет. */
  hideKey?: string;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!hideKey) return;
    try {
      setHidden(localStorage.getItem(hideKey) === "1");
    } catch {}
  }, [hideKey]);

  if (hidden) return null;
  return (
    <section className="support-card">
      <div className="support-card-head">
        <strong>{title}</strong>
        {hideKey && (
          <button
            type="button"
            className="support-card-close"
            aria-label="Больше не показывать"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem(hideKey, "1");
              } catch {}
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <p>{text}</p>
      <a className="button support-card-wa" href={href} target="_blank" rel="noopener noreferrer">
        <WhatsAppIcon />
        Написать в поддержку
      </a>
    </section>
  );
}
