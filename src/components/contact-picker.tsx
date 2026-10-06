"use client";
import { useEffect, useRef, useState } from "react";
import { normalizePhone, parseVcards, type PickedContact } from "@/lib/contacts";

type ContactsManager = {
  select(props: ("name" | "tel")[], options?: { multiple?: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>;
};

/**
 * Выбор контакта из телефона. Chrome на Android — системный список
 * (Contact Picker API); iPhone и компьютер его не умеют — там загрузка .vcf
 * («Поделиться контактом» → «Сохранить в Файлы»).
 */
export function ContactPicker({
  onPick,
  label = "Из контактов телефона",
  compact = false,
}: {
  onPick: (contact: PickedContact) => void;
  label?: string;
  /** Текстовая ссылка вместо кнопки (форма продажи). */
  compact?: boolean;
}) {
  const buttonClass = compact ? "text-button" : "button";
  const [native, setNative] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNative("contacts" in navigator && "ContactsManager" in window);
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

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setNote(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setNote("Файл слишком большой.");
    const [contact, ...rest] = parseVcards(await file.text());
    if (!contact) return setNote("В файле нет контакта с именем и телефоном.");
    onPick(contact);
    if (rest.length) setNote(`В файле ${rest.length + 1} контактов — взяли первый: ${contact.name}.`);
  }

  return (
    <span className="contact-picker">
      {native ? (
        <button type="button" className={buttonClass} onClick={pickNative}>
          {label}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={buttonClass}
            title="Контакт из телефона"
            onClick={() => fileInput.current?.click()}
          >
            {label}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".vcf,text/vcard,text/x-vcard"
            hidden
            onChange={pickFile}
          />
        </>
      )}
      {note && <small className="muted">{note}</small>}
    </span>
  );
}
