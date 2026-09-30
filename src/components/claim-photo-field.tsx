"use client";

import { useEffect, useRef, useState } from "react";
import { DOCUMENT_ACCEPT, isPdf } from "@/lib/pages";

/**
 * Фото или PDF квитанции на странице клиента: большая кнопка выбора, после
 * выбора — миниатюра, имя файла и «Убрать». Само поле остаётся в форме
 * (name="photo"), форма отправляется как обычно — без JS тоже работает.
 */
export function ClaimPhotoField() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file || isPdf(file)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clear() {
    if (input.current) input.current.value = "";
    setFile(null);
  }

  return (
    <div className="photo-field receipt-field">
      <span>Фото, скриншот или PDF квитанции (необязательно)</span>
      {file ? (
        <div className="receipt-picked">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Квитанция" />
          ) : (
            <span className="page-thumb-pdf">PDF</span>
          )}
          <span className="receipt-picked-text">{file.name}</span>
          <button type="button" className="receipt-remove" onClick={clear}>
            × Убрать
          </button>
        </div>
      ) : null}
      <label className={file ? "sr-only" : "button page-add"}>
        Сфотографировать или выбрать чек
        <input
          ref={input}
          name="photo"
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}
