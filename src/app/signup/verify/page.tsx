import Link from "next/link";
import { cookies } from "next/headers";
import { changeSignupEmail, resendSignup, verifySignup } from "../../auth/actions";
import { Submit } from "@/components/submit";
import { SignupIntro } from "@/components/signup-intro";
import { SIGNUP_EMAIL_COOKIE } from "@/lib/signup";

/**
 * Второй шаг регистрации: код из письма. Ссылка из того же письма ведёт на
 * /auth/confirm и дальше сразу на /onboarding — код нужен, когда почту
 * открыли на другом устройстве или ссылка не открывается. Сюда же ведёт вход
 * с неподтверждённым email (state=unconfirmed).
 */
export default async function VerifySignup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; state?: string }>;
}) {
  const { error, sent, state } = await searchParams;
  const email = (await cookies()).get(SIGNUP_EMAIL_COOKIE)?.value ?? "";
  return (
    <main className="auth">
      <SignupIntro step={2} />
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">ШАГ 2 ИЗ 3</span>
          <h2>Код из письма</h2>
          {state === "unconfirmed" && (
            <p className="notice" role="status">
              Почта ещё не подтверждена. Введите код из письма Depter или попросите новый.
            </p>
          )}
          <p className="muted">
            {email ? (
              <>
                Отправили письмо на <strong>{email}</strong>. Введите код из него или нажмите кнопку в письме.
              </>
            ) : (
              "Введите email, на который регистрировались, и код из письма Depter. Письма нет - войдите с email и паролем, и мы предложим отправить код ещё раз."
            )}
          </p>
          {sent && !error && (
            <p className="notice success" role="status">
              Письмо отправлено ещё раз. Не видно - загляните в «Спам».
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error === "rate"
                ? "Слишком много попыток. Подождите несколько минут и попробуйте снова."
                : error === "email"
                  ? "Впишите email, на который регистрировались."
                  : "Код не подошёл или устарел. Проверьте цифры или попросите новый код."}
            </p>
          )}
          <form action={verifySignup}>
            {!email && (
              <label>
                Email
                <input name="email" type="email" autoComplete="email" required maxLength={254} />
              </label>
            )}
            <label>
              Код
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,12}"
                required
                maxLength={12}
                placeholder="123456"
                autoFocus={Boolean(email)}
              />
            </label>
            <Submit>Подтвердить</Submit>
          </form>
          {email && (
            <form action={resendSignup}>
              <small className="muted">
                Письмо не пришло? Проверьте «Спам» или{" "}
                <button type="submit" className="text-button">
                  отправьте код ещё раз
                </button>
              </small>
            </form>
          )}
          {email && (
            <form action={changeSignupEmail}>
              <small className="muted">
                Ошиблись в почте?{" "}
                <button type="submit" className="text-button">
                  Зарегистрироваться с другим email
                </button>
              </small>
            </form>
          )}
          <small className="muted">
            Уже подтвердили? <Link href="/login">Войти</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
