"use client";
import { useEffect } from "react";

/**
 * Черновик формы в браузере: вписанное не пропадает, если человек ушёл со
 * страницы, закрыл вкладку или сервер вернул форму с ошибкой. Хранит только
 * поля из `fields`; storageKey — свой на пользователя. Хранилище закрыто
 * (приватный режим) — форма просто работает без черновика.
 */
export function FormDraft({ formId, storageKey, fields }: { formId: string; storageKey: string; fields: string[] }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, string>;
      for (const name of fields) {
        const el = field(name);
        if (el && typeof saved[name] === "string" && saved[name]) el.value = saved[name];
      }
    } catch {}
    const save = () => {
      const data: Record<string, string> = {};
      for (const name of fields) data[name] = field(name)?.value ?? "";
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch {}
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [formId, storageKey, fields]);
  return null;
}
