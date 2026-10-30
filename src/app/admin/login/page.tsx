import { redirect } from "next/navigation";
import { adminSession } from "@/lib/admin";
import { adminLogin } from "../actions";
import { Submit } from "@/components/submit";
import { Turnstile } from "@/components/turnstile";
import { AdminBrand } from "@/components/admin-brand";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  credentials: "Неверный email или пароль.",
  captcha: "Не прошла проверка «я не робот». Подождите пару секунд и нажмите ещё раз.",
  rate: "Слишком много попыток. Подождите несколько минут.",
};

/** Вход в админку: depter.kg/admin ведёт сюда, пока не вошли. Дальше — код из приложения. */
export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { user, admin, aal2 } = await adminSession();
  if (user && admin) redirect(aal2 ? "/admin" : "/admin/mfa");
  return (
    <main className="adm-login">
      <div className="adm-login-card">
        <AdminBrand />
        <h1>Вход для администратора</h1>
        <p className="muted">Только для команды Depter.</p>
        {error && errors[error] && (
          <p className="form-error" role="alert">
            {errors[error]}
          </p>
        )}
        <form action={adminLogin}>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label>
            Пароль
            <input name="password" type="password" autoComplete="current-password" required maxLength={1024} />
          </label>
          <Turnstile />
          <Submit>Войти</Submit>
        </form>
      </div>
    </main>
  );
}
