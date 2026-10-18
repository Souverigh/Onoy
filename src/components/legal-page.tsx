import Link from "next/link";
import { LEGAL, legalDate } from "@/lib/legal";

/**
 * Кто оператор — одной строкой для текста документов. Пока ИП или ОсОО нет
 * (17.10.2026) — «команда сервиса Depter»; заполните LEGAL — появятся реквизиты.
 */
export function Operator() {
  return (
    <>
      {LEGAL.operator || "команда сервиса Depter"}
      {LEGAL.inn ? `, ИНН ${LEGAL.inn}` : ""}
    </>
  );
}

/** Контакты — только заполненные. */
export function Contacts() {
  return (
    <ul>
      {LEGAL.email && <li>Email: {LEGAL.email}</li>}
      <li>Телефон, WhatsApp, Telegram: {LEGAL.phone}</li>
      {LEGAL.address && <li>Адрес: {LEGAL.address}</li>}
    </ul>
  );
}

/**
 * Страница документа (политика, соглашение): открывается без входа — со
 * страницы входа, из регистрации, со страницы клиента и из Настроек.
 */
export function LegalPage({
  title,
  current,
  children,
}: {
  title: string;
  current: "privacy" | "terms";
  children: React.ReactNode;
}) {
  return (
    <main className="legal">
      <header className="legal-head">
        <Link className="brand" href="/login">
          Depter<span>учёт долгов без лишнего</span>
        </Link>
        <nav className="legal-nav" aria-label="Документы">
          <Link href="/privacy" aria-current={current === "privacy" ? "page" : undefined}>
            Политика конфиденциальности
          </Link>
          <Link href="/terms" aria-current={current === "terms" ? "page" : undefined}>
            Пользовательское соглашение
          </Link>
        </nav>
      </header>
      <article className="legal-article">
        <h1>{title}</h1>
        <p className="muted">Редакция от {legalDate}</p>
        {children}
      </article>
      <footer className="legal-foot muted">
        <Link href="/login">← На главную</Link> · <Link href="/">Открыть приложение</Link>
      </footer>
    </main>
  );
}

/** Ссылки на документы — внизу страницы входа, регистрации, страницы клиента. */
export function LegalLinks({ className = "legal-links" }: { className?: string }) {
  return (
    <p className={className}>
      <Link href="/privacy">Политика конфиденциальности</Link> · <Link href="/terms">Пользовательское соглашение</Link>
    </p>
  );
}
