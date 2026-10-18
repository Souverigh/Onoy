import Link from "next/link";
import { signUp } from "../auth/actions";
import { Submit } from "@/components/submit";

// Регистрация владельца: аккаунт → /onboarding (название магазина + код доступа).
export default async function SignUp({ searchParams }: { searchParams: Promise<{ error?: string; check?: string }> }) {
  const { error, check } = await searchParams;
  return (
    <main className="auth">
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">НОВЫЙ МАГАЗИН</span>
          <h2>Регистрация</h2>
          <p className="muted">
            Для владельца магазина. Понадобится код доступа от Depter. Продавцу регистрироваться здесь не нужно -
            откройте ссылку-приглашение от владельца.
          </p>
          {check === "email" && (
            <p className="notice" role="status">
              Мы отправили письмо - подтвердите email, затем войдите.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error === "disabled"
                ? "Регистрация сейчас выключена. Напишите в Depter."
                : error === "consent"
                  ? "Чтобы создать аккаунт, примите Пользовательское соглашение и Политику конфиденциальности."
                  : "Не удалось создать аккаунт. Проверьте email; пароль - не короче 6 символов."}
            </p>
          )}
          <form action={signUp}>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <label>
              Пароль (не короче 6 символов)
              <input name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={1024} />
            </label>
            <label className="consent">
              <input type="checkbox" name="accept" value="1" required />
              <span>
                Принимаю{" "}
                <a href="/terms" target="_blank" rel="noreferrer">
                  Пользовательское соглашение
                </a>{" "}
                и{" "}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  Политику конфиденциальности
                </a>
                , согласен на обработку персональных данных
              </span>
            </label>
            <Submit>Создать аккаунт</Submit>
          </form>
          <small className="muted">
            Уже есть аккаунт? <Link href="/login">Войти</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
