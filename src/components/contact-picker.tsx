"use client";
import { useEffect, useState } from "react";
import { normalizePhone, type PickedContact } from "@/lib/contacts";

type ContactsManager = {
  select(props: ("name" | "tel")[], options?: { multiple?: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>;
};

/** iPhone/iPad (iPad с iOS 13+ притворяется Mac — отличаем по сенсорному экрану). */
export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * Выбор контакта из телефона. Chrome на Android — системный список
 * (Contact Picker API).
 * Safari на iPhone списка сайтам не даёт, но у полей с autoComplete="name"/"tel"
 * над клавиатурой есть «Автозаполнение контакта» — объясняем, как им пользоваться.
 * Android не в Chrome (Samsung Internet и т.п.) списка контактов не даёт —
 * объясняем, что открыть в Chrome. На компьютере контактов нет — кнопку не показываем.
 */
export function ContactPicker({
  onPick,
  label = "Из контактов телефона",
  compact = false,
  icon = false,
  className,
  iosFallback,
}: {
  onPick: (contact: PickedContact) => void;
  label?: string;
  /** Текстовая ссылка вместо кнопки (форма продажи). */
  compact?: boolean;
  /** Иконка внутри поля «Телефон» (PhoneField) вместо кнопки с текстом. */
  icon?: boolean;
  /** Класс кнопки вместо обычного (пункт выпадающего списка). */
  className?: string;
  /** iPhone: вместо подсказки открыть форму с полями имени и телефона (кнопка в выпадающем списке). */
  iosFallback?: () => void;
}) {
  const buttonClass = className ?? (icon ? "contact-icon-button" : compact ? "text-button" : "button");
  const content = icon ? <ContactsIcon /> : label;
  const [native, setNative] = useState(false);
  const [android, setAndroid] = useState(false);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setNative("contacts" in navigator && "ContactsManager" in window);
    setAndroid(/Android/i.test(navigator.userAgent));
    setIos(isIos());
  }, []);

  async function pickNative() {
    setNote(null);
    try {
      const contacts = (navigator as Navigator & { contacts: ContactsManager }).contacts;
      const [picked] = await contacts.select(["name", "tel"]);
      if (!picked) return;
      const phone = (picked.tel ?? []).map(normalizePhone).find(Boolean) ?? "";
      const name = (picked.name ?? []).find((n) => n.trim())?.trim() ?? "";
      if (!name && !phone) return setNote("У контакта нет имени и телефона.");
      onPick({ name: name.slice(0, 160), phone });
    } catch {
      setNote("Не удалось открыть контакты. Введите вручную.");
    }
  }

  if (!native && !android && !ios) return null;

  return (
    <span className="contact-picker">
      <button
        type="button"
        className={buttonClass}
        aria-label={label}
        title={icon ? label : native ? undefined : "Контакт из телефона"}
        onClick={() => (native ? pickNative() : ios && iosFallback ? iosFallback() : setHelp((open) => !open))}
      >
        {content}
      </button>
      {help && (
        <small className="contact-picker-help">
          {ios ? (
            <IosAutofillHint />
          ) : (
            <>
              Этот браузер не открывает контакты телефона. Откройте depter.kg в{" "}
              <strong>Google Chrome</strong> - там кнопка сразу покажет контакты. Или впишите имя и
              телефон вручную.
            </>
          )}
        </small>
      )}
      {note && <small className="muted">{note}</small>}
    </span>
  );
}

/** Как на iPhone взять контакт: Safari сам заполняет поля с autoComplete="name"/"tel". */
export function IosAutofillHint() {
  return (
    <>
      Нажмите на поле имени или телефона - над клавиатурой появится{" "}
      <strong>«Автозаполнение контакта»</strong>. Нажмите его и выберите нужный контакт: Safari сам впишет имя и
      телефон.
    </>
  );
}

/** Записная книжка — значок «выбрать из контактов». */
function ContactsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="15" height="18" rx="2" />
      <path d="M3 8h3M3 12h3M3 16h3" />
      <circle cx="12.5" cy="10" r="2.5" />
      <path d="M8.5 17c.6-2 2.2-3 4-3s3.4 1 4 3" />
    </svg>
  );
}

/**
 * Поле телефона со значком контактов справа: выбрали контакт — onPick
 * (обычно заполняет телефон, а имя — если пустое). children — сам <input>.
 */
export function PhoneField({
  children,
  onPick,
}: {
  children: React.ReactNode;
  onPick: (contact: PickedContact) => void;
}) {
  return (
    <span className="phone-field">
      {children}
      <ContactPicker icon onPick={onPick} />
    </span>
  );
}
