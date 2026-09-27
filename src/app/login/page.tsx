import { login } from "../auth/actions";
import { configured } from "@/lib/supabase/server";
import { Submit } from "@/components/submit";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ready = configured();
  return (
    <main className="auth">
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
        </div>
        <small>Сделано для ежедневной работы</small>
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
                {error && (
                  <p role="alert" className="form-error">
                    Не удалось войти. Проверьте email и пароль и повторите
                    попытку.
                  </p>
                )}
                <Submit>Войти в Depter</Submit>
              </form>
              <small className="muted">
                Новый магазин? <a href="/signup">Зарегистрироваться</a> — понадобится код доступа от Depter.
                Продавцы входят по ссылке-приглашению от владельца.
              </small>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
