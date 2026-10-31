import Link from "next/link";
import { requestPasswordReset } from "../auth/actions";
import { Submit } from "@/components/submit";
import { Turnstile } from "@/components/turnstile";
import { TeachSteps } from "@/components/teach";

const errors: Record<string, string> = {
  email: "Введите email, с которым входите в Depter.",
  rate: "Письма уже отправлялись недавно. Подождите несколько минут и попробуйте снова.",
  link: "Ссылка из письма устарела или уже использована. Запросите новое письмо.",
  captcha: "Не прошла проверка «я не робот». Подождите пару секунд и нажмите ещё раз.",
};

// «Забыли пароль?»: письмо со ссылкой на новый пароль (см. requestPasswordReset).
export default async function Forgot({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <main className="auth">
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">ВОССТАНОВЛЕНИЕ ДОСТУПА</span>
          <h2>Забыли пароль?</h2>
          <p className="muted">Введите email - пришлём ссылку, по которой можно задать новый пароль.</p>
          {sent ? (
            <>
              <div className="notice success mail-sent" role="status">
                <p className="mail-sent-title">
                  <span className="mail-sent-check" aria-hidden="true">
                    ✓
                  </span>
                  Письмо отправлено
                </p>
                <TeachSteps steps={["Откройте письмо от Depter", "Нажмите «Задать новый пароль» - ссылка действует 1 час"]} />
              </div>
              <div className="mail-help">
                <strong>Письма нет через пару минут?</strong>
                <p>Проверьте папку «Спам», а на iPhone - «Нежелательные».</p>
                <Link href="/forgot">Отправить ещё раз</Link>
              </div>
              {/* Не говорим, есть ли такой email, — иначе по экрану можно проверять чужие адреса. */}
              <p className="muted mail-fine">Письмо приходит, только если этот email есть в Depter.</p>
            </>
          ) : (
            <>
              {error && errors[error] && (
                <p className="form-error" role="alert">
                  {errors[error]}
                </p>
              )}
              <form action={requestPasswordReset}>
                <label>
                  Email
                  <input name="email" type="email" autoComplete="email" required maxLength={254} />
                </label>
                <Turnstile />
                <Submit>Отправить ссылку</Submit>
              </form>
            </>
          )}
          <small className="muted">
            Вспомнили? <Link href="/login">Войти</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
