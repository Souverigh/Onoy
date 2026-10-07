"use client";
import { useRef } from "react";
import { ContactPicker } from "./contact-picker";

/**
 * Значок контактов в поле «Телефон» (внутри .phone-field): заполняет имя и
 * телефон в форме, внутри которой стоит.
 */
export function ContactFill() {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} className="contact-fill">
      <ContactPicker
        icon
        onPick={({ name, phone }) => {
          const form = anchor.current?.closest("form");
          if (!form) return;
          const set = (field: string, value: string) => {
            const input = form.elements.namedItem(field);
            if (input instanceof HTMLInputElement && value) input.value = value;
          };
          set("name", name);
          set("phone", phone);
        }}
      />
    </span>
  );
}
