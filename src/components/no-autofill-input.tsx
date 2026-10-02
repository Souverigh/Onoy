"use client";
import { useState, type InputHTMLAttributes } from "react";

/**
 * Поле, которое браузер не заполняет сам при открытии страницы (Chrome
 * игнорирует autocomplete="off" у паролей): пока поле не в фокусе, оно
 * readOnly, а такие браузер не трогает. Нажали — обычное поле; сохранённый
 * пароль можно выбрать из подсказки вручную.
 */
export function NoAutofillInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [locked, setLocked] = useState(true);
  return (
    <input
      {...props}
      autoComplete="off"
      readOnly={locked}
      // Касание — раньше фокуса: на iPhone клавиатура откроется с первого раза.
      onPointerDown={(e) => {
        setLocked(false);
        props.onPointerDown?.(e);
      }}
      onFocus={(e) => {
        setLocked(false);
        props.onFocus?.(e);
      }}
    />
  );
}
