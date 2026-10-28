import Link from "next/link";
import { signUp } from "../auth/actions";
import { Submit } from "@/components/submit";
import { PRESETS, isBusinessType } from "@/lib/business";

// Регистрация владельца: email и пароль → код из письма (/signup/verify) →
// /onboarding (магазин и вид бизнеса). Первый месяц бесплатно.
// ?type= — пришли по адресу вида бизнеса (/start/prokat): магазин создастся этим видом.
export default async function SignUp({ searchParams }: { searchParams: Promise<{ error?: string; type?: string }> }) {
  const { error, type } = await searchParams;
  const business = isBusinessType(type) ? type : null;
  return (
    <main className="auth">
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">{business ? PRESETS[business].label.toUpperCase() : "НОВЫЙ МАГАЗИН"}</span>
          <h2>Регистрация</h2>
          <p className="muted">
            Первый месяц бесплатно, без карты и без звонков. Пришлём код на почту - и вы в своём магазине.
          </p>
          <p className="muted">
            Вы продавец? Регистрироваться не нужно - откройте ссылку-приглашение от владельца.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error === "disabled"
                ? "Регистрация сейчас выключена. Напишите в Depter."
                : error === "consent"
                  ? "Чтобы создать аккаунт, примите Пользовательское соглашение и Политику конфиденциальности."
                  : error === "rate"
                    ? "Слишком много попыток. Подождите несколько минут и попробуйте снова."
                    : "Не удалось создать аккаунт. Проверьте email; пароль - не короче 6 символов."}
            </p>
          )}
          <form action={signUp}>
            {business && <input type="hidden" name="business_type" value={business} />}
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
            <Submit>Получить код на почту</Submit>
          </form>
          <small className="muted">
            Уже есть аккаунт? <Link href="/login">Войти</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
