"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";

type Props = {
  /** Номер клиента, только цифры; пусто — WhatsApp спросит, кому отправить. */
  phone: string;
  /** Текст для wa.me: накладная ссылкой (если сверена) и страница клиента. */
  text: string;
  /** Текст к файлу при «Поделиться» — файл уже приложен, ссылка на страницу клиента остаётся. */
  fileText: string;
  /** Картинка накладной (PNG); null — накладная ещё не сверена. */
  imageUrl: string | null;
  fileName: string;
  /** Распознавание ещё идёт — обновляем страницу, пока не закончится. */
  pending: boolean;
  /** Тип файла: картинка накладной (по умолчанию) или PDF (приход). */
  fileType?: "image/png" | "application/pdf";
  /** Кому: «клиенту» или «поставщику» — в подписях кнопок. */
  to?: string;
  /** Ещё действия — иконками в ряд под главной кнопкой (печать, ещё продажа…). */
  children?: React.ReactNode;
};

const REFRESH_MS = 4000;
const REFRESH_LIMIT = 15;

/**
 * «Отправить клиенту» (задача 8). Номер известен — сразу чат WhatsApp, файл
 * второй кнопкой. Номера нет — системное «Поделиться» с файлом накладной и
 * текстом со ссылкой, чат выбирают там. Компьютер
 * (браузер не делится файлами): «Скачать» и «Открыть WhatsApp». share()
 * требует свежего нажатия, поэтому картинку скачиваем заранее.
 */
export function SendInvoice({
  phone,
  text,
  fileText,
  imageUrl,
  fileName,
  pending,
  fileType = "image/png",
  to = "клиенту",
  children,
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [canShareFile, setCanShareFile] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "retry" | "error" | "sent">("idle");
  const refreshes = useRef(0);

  const waHref = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  const waFileHref = `https://wa.me/${phone}?text=${encodeURIComponent(fileText)}`;

  useEffect(() => {
    if (!imageUrl || typeof navigator.canShare !== "function") return;
    const probe = new File([""], fileType === "image/png" ? "probe.png" : "probe.pdf", { type: fileType });
    if (!navigator.canShare({ files: [probe] })) return;
    setCanShareFile(true);
    let cancelled = false;
    fetch(imageUrl)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!cancelled) setFile(new File([blob], fileName, { type: fileType }));
      })
      .catch(() => {
        if (!cancelled) setCanShareFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, fileName, fileType]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (refreshes.current >= REFRESH_LIMIT) return clearInterval(timer);
      refreshes.current += 1;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  async function shareFile() {
    let image = file;
    if (!image) {
      setState("loading");
      try {
        const res = await fetch(imageUrl!);
        if (!res.ok) throw new Error(String(res.status));
        image = new File([await res.blob()], fileName, { type: fileType });
        setFile(image);
      } catch {
        setState("error");
        return;
      }
    }
    const data: ShareData = { files: [image], text: fileText };
    // Пробный файл прошёл, а настоящий могут отклонить (имя, размер) — тогда
    // share() падает без окна, и кнопка «ничего не делает».
    if (!navigator.canShare(data)) {
      setState("error");
      return;
    }
    try {
      await navigator.share(data);
      setState("sent");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      // AbortError — продавец сам закрыл окно; NotAllowedError — пока качали
      // файл, «нажатие» устарело: файл уже готов, второе нажатие сработает.
      setState(name === "AbortError" ? "idle" : name === "NotAllowedError" ? "retry" : "error");
    }
  }

  // Второстепенное — одним рядом иконок под главной кнопкой (как в банковских
  // приложениях): файлом / скачать, затем то, что передала страница.
  const row = (file: React.ReactNode) =>
    file || children ? (
      <div className="send-actions">
        {file}
        {children}
      </div>
    ) : null;
  const waMain = (
    <a className="button primary send-main" href={waHref} target="_blank" rel="noreferrer">
      <Icon name="chat" />
      Отправить {to} в WhatsApp
    </a>
  );

  // Накладная не сверена — только текст с долгом и ссылкой.
  if (!imageUrl)
    return (
      <div className="send-invoice">
        {waMain}
        {row(null)}
      </div>
    );

  // Телефон есть — сразу в чат с этим человеком, файл — иконкой. «Поделиться»
  // не умеет выбрать чат сам: продавцу лишние шаги и на экране чужие чаты.
  if (phone)
    return (
      <div className="send-invoice">
        {waMain}
        {row(
          canShareFile ? (
            <button className="send-action" type="button" onClick={shareFile} disabled={state === "loading"}>
              <Icon name="share" />
              <span>{state === "loading" ? "Готовим…" : "Поделиться"}</span>
            </button>
          ) : (
            <a className="send-action" href={`${imageUrl}?download=1`} download={fileName}>
              <Icon name="download" />
              <span>Скачать</span>
            </a>
          ),
        )}
        {state === "error" && (
          <p className="form-error" role="alert">
            Не удалось приложить файл - отправьте ссылкой кнопкой выше.
          </p>
        )}
      </div>
    );

  if (canShareFile)
    return (
      <div className="send-invoice">
        <button className="button primary send-main" type="button" onClick={shareFile} disabled={state === "loading"}>
          {state === "loading" ? "Готовим накладную…" : state === "retry" ? "Накладная готова - отправить" : `Отправить ${to}`}
        </button>
        {row(null)}
        {state === "sent" && <p className="muted">Отправлено? Если WhatsApp не открылся - нажмите ещё раз.</p>}
        {state === "error" && (
          <p className="form-error" role="alert">
            Не удалось приложить файл.{" "}
            <a href={waHref} target="_blank" rel="noreferrer">
              Отправить текстом со ссылкой
            </a>
          </p>
        )}
      </div>
    );

  return (
    <div className="send-invoice send-invoice-desktop">
      <p className="send-invoice-title">Отправить {to}</p>
      <div className="send-invoice-actions">
        <a className="button primary" href={`${imageUrl}?download=1`} download={fileName}>
          1. Скачать накладную
        </a>
        <a className="button primary" href={waFileHref} target="_blank" rel="noreferrer">
          2. Открыть WhatsApp
        </a>
      </div>
      <small className="muted">
        В WhatsApp перетащите скачанный файл в чат с {to === "клиенту" ? "клиентом" : "поставщиком"} - текст{to === "клиенту" ? " со ссылкой" : ""} уже будет вписан.
      </small>
      {row(null)}
    </div>
  );
}
