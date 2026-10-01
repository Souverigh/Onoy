import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { EXPIRED_COOKIE, SEEN_COOKIE, inactivityExpired } from "@/lib/session-timeout";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return response;
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          response.headers.set("Cache-Control", "private, no-store");
        },
      },
    },
  );
  // Обновляет просроченную сессию (через getSession) и проверяет подпись
  // токена локально — без запроса в Supabase Auth на каждый переход.
  const { data } = await client.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return response;

  // Выход после 2 часов бездействия (src/lib/session-timeout.ts).
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : claims.sub;
  const now = Date.now();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  };
  if (inactivityExpired(request.cookies.get(SEEN_COOKIE)?.value, sessionId, now)) {
    // Отзывает refresh-токен этой сессии и стирает куки входа (через setAll —
    // и у запроса тоже, так что страница дальше сама уведёт на /login).
    await client.auth.signOut({ scope: "local" });
    request.cookies.delete(SEEN_COOKIE);
    response.cookies.delete(SEEN_COOKIE);
    response.cookies.set(EXPIRED_COOKIE, "1", { ...cookieOptions, maxAge: 300 });
    return response;
  }
  // Фоновая подгрузка ссылок (prefetch) — не действие пользователя.
  if (!request.headers.has("next-router-prefetch"))
    response.cookies.set(SEEN_COOKIE, `${sessionId}.${now}`, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30,
    });
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
