import Link from "next/link";
import { cookies } from "next/headers";
import { changeSignupEmail, resendSignup } from "../../auth/actions";
import { SignupIntro } from "@/components/signup-intro";
import { Turnstile } from "@/components/turnstile";
import { SIGNUP_EMAIL_COOKIE } from "@/lib/signup";

/**
 * Второй шаг регистрации: подтвердить почту по ссылке из письма. Ссылка ведёт
 * на /auth/confirm и дальше сразу на /onboarding — с любого устройства. Сюда же
 * ведёт вход с неподтверждённым email (state=unconfirmed).
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
          <h2>Подтвердите почту</h2>
          {state === "unconfirmed" && (
            <p className="notice" role="status">
              Почта ещё не подтверждена. Нажмите ссылку в письме Depter или попросите новое письмо.
            </p>
          )}
          <p className="muted">
            {email ? (
              <>
                Отправили письмо на <strong>{email}</strong>. Нажмите в нём ссылку - и вы перейдёте к созданию
                магазина. Письмо можно открыть и на другом телефоне.
              </>
            ) : (
              "Откройте письмо Depter и нажмите в нём ссылку. Письма нет - войдите с email и паролем, и мы предложим отправить его ещё раз."
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
                : error === "captcha"
                  ? "Не прошла проверка «я не робот». Подождите пару секунд и нажмите ещё раз."
                  : "Впишите email, на который регистрировались."}
            </p>
          )}
          {email && (
            <form action={resendSignup}>
              <small className="muted">
                Письмо не пришло? Проверьте «Спам» или{" "}
                <button type="submit" className="text-button">
                  отправьте его ещё раз
                </button>
              </small>
              <Turnstile />
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
