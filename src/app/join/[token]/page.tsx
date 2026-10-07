import Link from "next/link";
import { acceptInvite, login, signUpByInvite } from "@/app/auth/actions";
import { configured, createAnonClient, createClient } from "@/lib/supabase/server";
import { Submit } from "@/components/submit";

const errors: Record<string, string> = {
  credentials: "Не удалось войти. Проверьте email и пароль.",
  signup: "Не удалось создать аккаунт. Проверьте email; пароль - не короче 6 символов.",
  signup_disabled: "Регистрация новых аккаунтов выключена. Попросите владельца магазина или администратора.",
  accept: "Не удалось присоединиться. Возможно, ссылка уже использована - попросите новую.",
  member: "Вы уже работаете в этом магазине.",
};

// Приглашение продавца (ТЗ, тариф «Бизнес»): ссылка от владельца, 7 дней, одна.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; check?: string }>;
}) {
  const { token } = await params;
  const { error, check } = await searchParams;
  const invite =
    configured() && /^[a-f0-9]{32}$/i.test(token)
      ? await createAnonClient().rpc("get_invite", { p_token: token })
      : null;
  const data = invite && !invite.error ? (invite.data as { shop_name: string; display_name: string }) : null;
  const user = configured() ? (await (await createClient()).auth.getUser()).data.user : null;

  return (
    <main className="auth">
      <section className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">ПРИГЛАШЕНИЕ</span>
          {!data ? (
            <>
              <h2>Ссылка недействительна</h2>
              <p className="muted">
                Приглашение уже использовано, отменено или истекло (действует 7 дней). Попросите владельца магазина
                прислать новое.
              </p>
              <Link className="button" href="/login">
                Войти
              </Link>
            </>
          ) : (
            <>
              <h2>{data.shop_name}</h2>
              <p className="muted">
                {data.display_name}, вас пригласили работать продавцом в Depter: оформлять продажи, товар от поставщиков и
                оплаты.
              </p>
              {error && errors[error] && (
                <p className="form-error" role="alert">
                  {errors[error]}
                </p>
              )}
              {check === "email" && (
                <p className="notice" role="status">
                  Мы отправили письмо - подтвердите email и откройте эту ссылку снова.
                </p>
              )}
              {user ? (
                <form action={acceptInvite}>
                  <input type="hidden" name="token" value={token} />
                  <p className="muted">Вы вошли как {user.email ?? user.phone}.</p>
                  <Submit>Присоединиться к магазину</Submit>
                </form>
              ) : (
                <>
                  <form action={signUpByInvite}>
                    <h3>Новый аккаунт</h3>
                    <input type="hidden" name="token" value={token} />
                    <label>
                      Email
                      <input name="email" type="email" autoComplete="email" required maxLength={254} />
                    </label>
                    <label>
                      Придумайте пароль (не короче 6 символов)
                      <input name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={1024} />
                    </label>
                    <Submit>Создать аккаунт и присоединиться</Submit>
                  </form>
                  <form action={login}>
                    <h3>Уже есть аккаунт</h3>
                    <input type="hidden" name="next" value={`/join/${token}`} />
                    <label>
                      Email
                      <input name="email" type="email" autoComplete="email" required maxLength={254} />
                    </label>
                    <label>
                      Пароль
                      <input name="password" type="password" autoComplete="current-password" required maxLength={1024} />
                    </label>
                    <Submit>Войти</Submit>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
