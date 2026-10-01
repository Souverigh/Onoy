import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient, configured } from "@/lib/supabase/server";

/** Куда можно вернуть после ссылки из письма — только свои страницы. */
const ALLOWED_NEXT = new Set(["/reset-password"]);

/**
 * Ссылка из письма Supabase (сброс пароля). Два вида:
 * - стандартный шаблон: Supabase проверяет ссылку сам и присылает сюда ?code=
 *   (PKCE — работает только в том же браузере, где просили письмо);
 * - свой шаблон «Reset Password» со ссылкой
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
 *   — работает из любого браузера и с другого телефона.
 * Успех — сессия в куках и переход на next; иначе — /forgot с пояснением.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = ALLOWED_NEXT.has(url.searchParams.get("next") ?? "") ? url.searchParams.get("next")! : "/reset-password";
  const fail = NextResponse.redirect(new URL("/forgot?error=link", url.origin));
  if (!configured()) return fail;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const db = await createClient();
  const { error } = code
    ? await db.auth.exchangeCodeForSession(code)
    : tokenHash && type === "recovery"
      ? await db.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("no code") };
  if (error) {
    console.warn("auth/confirm:", error.message);
    return fail;
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
