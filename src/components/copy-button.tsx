"use client";
import { useState } from "react";

/** Копирует текст (ссылку) в буфер; на пару секунд пишет «Скопировано». */
export function CopyButton({ text, className = "button" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Нет доступа к буферу (старый браузер, http) — ссылка видна рядом, её можно выделить.
        }
      }}
    >
      {copied ? "Скопировано ✓" : "Копировать"}
    </button>
  );
}
