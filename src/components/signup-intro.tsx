import { PRICE_KGS } from "@/lib/subscription";

const STEPS = ["Email и пароль", "Код из письма", "Название магазина и вид бизнеса"];

/**
 * Левая половина страниц регистрации (как витрина у входа): что будет и на каком
 * шаге человек. На телефоне — только логотип и заголовок, форма сразу ниже.
 */
export function SignupIntro({ step }: { step: 1 | 2 | 3 }) {
  return (
    <section className="auth-intro signup-intro">
      <a className="brand" href="/login">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-inverted.svg" alt="" className="brand-logo" />
        Depter<span>учёт долгов без лишнего</span>
      </a>
      <div>
        <span className="eyebrow">ПОДКЛЮЧЕНИЕ МАГАЗИНА</span>
        <h1>Ваш магазин в Depter за 2 минуты</h1>
        <ol className="signup-steps">
          {STEPS.map((title, i) => (
            <li key={title} className={i + 1 < step ? "done" : i + 1 === step ? "current" : undefined}>
              <span aria-hidden="true">{i + 1 < step ? "✓" : i + 1}</span>
              {title}
            </li>
          ))}
        </ol>
        <p>
          Первый месяц бесплатно, без карты. Дальше {PRICE_KGS.toLocaleString("ru-RU")} сом в месяц - продлить
          можно в любой момент, данные остаются у вас.
        </p>
      </div>
      <small>Старую тетрадь перенесёте по фото - Depter сам запишет, кто сколько должен.</small>
    </section>
  );
}
