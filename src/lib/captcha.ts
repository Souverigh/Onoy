/**
 * Проверка «я не робот» (Cloudflare Turnstile, components/turnstile.tsx).
 * Включается в Supabase → Authentication → Attack Protection (там — Secret
 * Key); тогда вход, регистрация и письма без ответа проверки не проходят.
 * Site Key — в NEXT_PUBLIC_TURNSTILE_SITE_KEY; нет его — проверки нет.
 */

/** Ответ проверки — скрытое поле, которое Turnstile кладёт в форму. */
export const captchaToken = (form: FormData) => String(form.get("cf-turnstile-response") ?? "") || undefined;

/** Supabase отклонил запрос: проверки нет, она не пройдена или устарела. */
export const captchaFailed = (error: { code?: string } | null) => error?.code === "captcha_failed";
