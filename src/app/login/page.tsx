import type { Metadata } from "next";
import { LegalLinks } from "@/components/legal-page";
import Link from "next/link";
import { login } from "../auth/actions";
import { configured } from "@/lib/supabase/server";
import { Submit } from "@/components/submit";
import { Turnstile } from "@/components/turnstile";
import { cookies } from "next/headers";
import { EXPIRED_COOKIE, INACTIVITY_LIMIT_MS } from "@/lib/session-timeout";
import { ContactLinks } from "@/components/contact-links";
import { InstallApp } from "@/components/install-app";
import { sendFeedback } from "./actions";
import { DEPTER_PHONE } from "@/components/contact-links";
import { PRICE_KGS } from "@/lib/subscription";
import { GoogleButton } from "@/components/google-button";
import { OPEN_GRAPH_BASE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

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
  openGraph: { ...OPEN_GRAPH_BASE, title: SITE_TITLE, description: SITE_DESCRIPTION, url: "/login" },
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
        <div className="landing-top">
          <a className="brand" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-inverted.svg" alt="" className="brand-logo" />
            Depter<span>учёт долгов без лишнего</span>
          </a>
          {ready && (
            <a className="button landing-signup" href="/signup">
              Регистрация
            </a>
          )}
        </div>
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
                {error === "exists" ? (
                  <p role="alert" className="notice">
                    Этот email уже зарегистрирован - войдите с паролем. Не помните пароль - нажмите «Забыли
                    пароль?».
                  </p>
                ) : error === "google" ? (
                  <p role="alert" className="form-error">
                    Не удалось войти через Google. Попробуйте ещё раз или войдите по email и паролю.
                  </p>
                ) : error === "captcha" ? (
                  <p role="alert" className="form-error">
                    Не прошла проверка «я не робот». Подождите пару секунд и нажмите ещё раз.
                  </p>
                ) : error === "link" ? (
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
                <Turnstile />
                <Submit>Войти в Depter</Submit>
                <small className="muted consent-note">
                  Входя, вы принимаете <Link href="/terms">Пользовательское соглашение</Link> и{" "}
                  <Link href="/privacy">Политику конфиденциальности</Link>.
                </small>
              </form>
              <GoogleButton />
              <a className="button landing-signup-wide" href="/signup">
                Зарегистрировать магазин - месяц бесплатно
              </a>
              <small className="muted">Продавцы входят по ссылке-приглашению от владельца.</small>
              <InstallApp variant="button" />
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
          <li>Нажмите «Регистрация»: email и пароль.</li>
          <li>Нажмите ссылку в письме, чтобы подтвердить почту.</li>
          <li>Впишите название магазина и выберите, чем занимаетесь, - Depter сразу настроится под вас.</li>
        </ol>
        <p className="landing-lead">
          Первый месяц бесплатно, дальше {PRICE_KGS.toLocaleString("ru-RU")} сом в месяц. Старую тетрадь можно
          перенести по фото. Вопросы - пишите в Telegram или WhatsApp.
        </p>
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
        <LegalLinks />
      </section>
    </main>
  );
}
