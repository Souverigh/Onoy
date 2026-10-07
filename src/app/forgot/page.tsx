import Link from "next/link";
import { requestPasswordReset } from "../auth/actions";
import { Submit } from "@/components/submit";

const errors: Record<string, string> = {
  email: "Введите email, с которым входите в Depter.",
  rate: "Письма уже отправлялись недавно. Подождите несколько минут и попробуйте снова.",
  link: "Ссылка из письма устарела или уже использована. Запросите новое письмо.",
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
            <p className="notice success" role="status">
              Если такой email есть в Depter, письмо уже отправлено. Откройте его и нажмите на ссылку - она
              действует 1 час. Письма нет? Проверьте «Спам».
            </p>
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
