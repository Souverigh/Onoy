import Link from "next/link";
import { updatePassword } from "../auth/actions";
import { createClient, configured } from "@/lib/supabase/server";
import { Submit } from "@/components/submit";

const errors: Record<string, string> = {
  short: "Пароль — не короче 6 символов.",
  mismatch: "Пароли не совпадают. Введите один и тот же пароль дважды.",
  same: "Это ваш прежний пароль — придумайте новый.",
  weak: "Пароль слишком простой — добавьте цифры или буквы.",
  failed: "Не удалось сохранить пароль. Попробуйте ещё раз.",
};

// Новый пароль — после ссылки из письма (/auth/confirm открыл сессию).
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const claims = configured() ? (await (await createClient()).auth.getClaims()).data?.claims : null;
  return (
    <main className="auth">
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">ВОССТАНОВЛЕНИЕ ДОСТУПА</span>
          <h2>Новый пароль</h2>
          {!claims?.sub ? (
            <>
              <p className="form-error" role="alert">
                Ссылка устарела или уже использована. Запросите новое письмо.
              </p>
              <Link className="button primary" href="/forgot">
                Отправить письмо ещё раз
              </Link>
            </>
          ) : (
            <>
              <p className="muted">
                {typeof claims.email === "string" ? `Для ${claims.email}. ` : ""}После сохранения вход на других
                устройствах закроется.
              </p>
              {error && errors[error] && (
                <p className="form-error" role="alert">
                  {errors[error]}
                </p>
              )}
              <form action={updatePassword}>
                <label>
                  Новый пароль (не короче 6 символов)
                  <input name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={1024} />
                </label>
                <label>
                  Повторите пароль
                  <input name="repeat" type="password" autoComplete="new-password" required minLength={6} maxLength={1024} />
                </label>
                <Submit>Сохранить пароль</Submit>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
