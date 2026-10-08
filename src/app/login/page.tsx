import type { Metadata } from "next";
import Link from "next/link";
import { login } from "../auth/actions";
import { configured } from "@/lib/supabase/server";
import { Submit } from "@/components/submit";
import { cookies } from "next/headers";
import { EXPIRED_COOKIE, INACTIVITY_LIMIT_MS } from "@/lib/session-timeout";
import { ContactLinks } from "@/components/contact-links";
import { sendFeedback } from "./actions";
import { DEPTER_PHONE } from "@/components/contact-links";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

// Витрина — единственная страница для поисковиков (src/app/robots.ts).
export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: [
    "учёт долгов",
    "тетрадь долгов",
    "долги клиентов",
    "долговая тетрадь онлайн",
    "учёт долгов магазина",
    "накладные",
    "расчёты с поставщиками",
    "Кыргызстан",
    "Бишкек",
  ],
  alternates: { canonical: "/login" },
  robots: { index: true, follow: true },
  openGraph: { title: SITE_TITLE, description: SITE_DESCRIPTION, url: "/login" },
};

const phoneDigits = DEPTER_PHONE.replace(/\D/g, "");
// Структурированные данные: поисковик понимает, что это за сервис и как связаться.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon`,
      telephone: `+${phoneDigits}`,
      sameAs: [`https://t.me/+${phoneDigits}`, `https://wa.me/${phoneDigits}`],
    },
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: `${SITE_URL}/login`,
      description: SITE_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "ru",
    },
  ],
};

// Сюда же ведёт QR с накладных (/r/<код>): новому магазину объясняем, что такое
// Depter, но вход всегда на виду — справа на компьютере, сразу под заголовком на телефоне.
const features = [
  ["Долги клиентов и поставщиков", "Кто сколько должен вам и кому должны вы - с историей каждой продажи и оплаты."],
  ["Тетрадь по фото", "Сфотографируйте страницу тетради или накладную - Depter сам перенесёт записи."],
  ["Накладные клиенту", "PDF или ссылка в WhatsApp. Клиент видит свой долг по ссылке, без регистрации."],
  ["Склад", "Остатки товаров: товар от поставщика и продажа меняют их сами."],
  ["Продавцы", "У каждого свой вход. Владелец видит, кто и что записал."],
  ["Итоги дня и отчёты", "Закрытие дня, просроченные обещания оплатить, выгрузка в Excel."],
];
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; feedback?: string }>;
}) {
  const { error, feedback } = await searchParams;
  const ready = configured();
  // Прокси вышел из сессии после бездействия (src/proxy.ts) — объясняем.
  const expired = (await cookies()).has(EXPIRED_COOKIE);
  const limitHours = INACTIVITY_LIMIT_MS / 3_600_000;
  return (
    <main className="auth landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="auth-intro">
        <a className="brand" href="/">
          Depter<span>учёт долгов без лишнего</span>
        </a>
        <div>
          <span className="eyebrow">ДЛЯ ВАШЕГО МАГАЗИНА</span>
          <h1>
            Порядок в долгах.
            <br />
            Свободная голова.
          </h1>
          <p>
            Кто должен вам, кому должны вы.
            <br />
            Всё нужное в одном месте.
          </p>
          <a className="landing-more" href="#about">
            Что такое Depter? ↓
          </a>
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">РАБОЧИЙ КАБИНЕТ</span>
          <h2>Рады вас видеть</h2>
          <p className="muted">Войдите, чтобы продолжить работу.</p>
          {!ready ? (
            <div className="notice">
              Приложение подготовлено к подключению. Для входа сначала настройте
              отдельную базу Depter по инструкции запуска.
            </div>
          ) : (
            <>
              {expired && !error && (
                <p className="notice" role="status">
                  Вы вышли автоматически: {limitHours} ч без действий. Войдите снова - данные на месте.
                </p>
              )}
              <form action={login}>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </label>
                <label>
                  Пароль
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={1024}
                  />
                </label>
                <Link className="forgot-link" href="/forgot">
                  Забыли пароль?
                </Link>
                {error === "link" ? (
                  <p role="alert" className="form-error">
                    Ссылка из письма устарела или уже открыта. Если email
                    подтверждён - просто войдите.
                  </p>
                ) : error ? (
                  <p role="alert" className="form-error">
                    Не удалось войти. Проверьте email и пароль и повторите
                    попытку.
                  </p>
                ) : null}
                <Submit>Войти в Depter</Submit>
              </form>
              <small className="muted">
                Новый магазин? <a href="/signup">Зарегистрироваться</a> - понадобится код доступа от Depter.
                Продавцы входят по ссылке-приглашению от владельца.
              </small>
            </>
          )}
        </div>
      </section>
      <section className="landing-about" id="about">
        <span className="eyebrow">ЧТО ТАКОЕ DEPTER</span>
        <h2>Тетрадь долгов магазина - только онлайн</h2>
        <p className="landing-lead">
          Depter заменяет бумажную тетрадь: записи не теряются, суммы считаются сами, а клиент в любой момент видит,
          сколько он должен. Работает в браузере на телефоне и компьютере - ничего устанавливать не нужно.
        </p>
        <ul className="landing-features">
          {features.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <h2>Как подключить магазин</h2>
        <ol className="landing-steps">
          <li>Напишите нам в Telegram или WhatsApp либо оставьте заявку ниже.</li>
          <li>Мы расскажем о тарифах и выдадим код доступа.</li>
          <li>Зарегистрируйтесь - старую тетрадь поможем перенести по фото.</li>
        </ol>
        <ContactLinks showPhone />

        <h2 id="feedback">Оставить заявку или вопрос</h2>
        {feedback === "sent" ? (
          <p className="notice success" role="status">
            Спасибо! Сообщение отправлено - мы ответим в ближайшее время.
          </p>
        ) : (
          <form action={sendFeedback} className="landing-feedback">
            {feedback && (
              <p role="alert" className="form-error">
                {feedback === "invalid"
                  ? "Заполните имя, телефон или Telegram и сообщение."
                  : feedback === "busy"
                    ? "Сейчас слишком много заявок. Попробуйте позже или напишите нам в WhatsApp."
                    : "Не удалось отправить. Напишите нам в Telegram или WhatsApp."}
              </p>
            )}
            <label>
              Имя
              <input name="name" required maxLength={120} autoComplete="name" />
            </label>
            <label>
              Телефон или Telegram
              <input name="contact" required minLength={3} maxLength={120} autoComplete="tel" />
            </label>
            <label>
              Сообщение
              <textarea name="message" required maxLength={2000} placeholder="Например: магазин стройматериалов, хотим вести долги клиентов" />
            </label>
            {/* Ловушка для ботов: людям не видна. */}
            <input className="landing-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <Submit>Отправить</Submit>
          </form>
        )}
        <small>Сделано для ежедневной работы</small>
      </section>
    </main>
  );
}
