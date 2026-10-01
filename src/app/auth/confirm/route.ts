import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient, configured } from "@/lib/supabase/server";

/** Куда можно вернуть после ссылки из письма — только свои страницы. */
function allowedNext(next: string | null) {
  return next === "/reset-password" || next === "/onboarding" || /^\/join\/[a-f0-9]{32}$/i.test(next ?? "")
    ? next!
    : null;
}

const OTP_TYPES = new Set<EmailOtpType>(["recovery", "signup", "email"]);

/**
 * Ссылка из письма Supabase: сброс пароля или подтверждение регистрации.
 * Два вида:
 * - стандартный шаблон: Supabase проверяет ссылку сам и присылает сюда ?code=
 *   (PKCE — работает только в том же браузере, где просили письмо);
 * - свой шаблон со ссылкой
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
 *   (для «Confirm signup» — type=email&next=/onboarding)
 *   — работает из любого браузера и с другого телефона.
 * Успех — сессия в куках и переход на next; иначе — пояснение: для сброса
 * пароля на /forgot, для регистрации на /login (email мог уже подтвердиться).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = allowedNext(url.searchParams.get("next")) ?? (type && type !== "recovery" ? "/onboarding" : "/reset-password");
  const fail = NextResponse.redirect(
    new URL(next === "/reset-password" ? "/forgot?error=link" : "/login?error=link", url.origin),
  );
  if (!configured()) return fail;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const db = await createClient();
  const { error } = code
    ? await db.auth.exchangeCodeForSession(code)
    : tokenHash && type && OTP_TYPES.has(type)
      ? await db.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("no code") };
  if (error) {
    console.warn("auth/confirm:", error.message);
    return fail;
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
