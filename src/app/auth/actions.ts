"use server";
import { redirect } from "next/navigation";
import { LEGAL } from "@/lib/legal";
import { revalidatePath } from "next/cache";
import { createAnonClient, createClient, configured } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/context";
import { cookies, headers } from "next/headers";
import { EXPIRED_COOKIE } from "@/lib/session-timeout";
import { storedPhone } from "@/lib/contacts";
import { BUSINESS_COOKIE, DEFAULT_BUSINESS, isBusinessType } from "@/lib/business";
import { SIGNUP_EMAIL_COOKIE } from "@/lib/signup";
/** Куда вернуть после входа: только страница приглашения, иначе главная. */
function nextPath(form: FormData) {
  const next = String(form.get("next") ?? "");
  return /^\/join\/[a-f0-9]{32}$/i.test(next) ? next : "/";
}

/**
 * Адрес сайта для ссылок в письмах (→ /auth/confirm). Должен быть в Supabase →
 * Authentication → URL Configuration → Redirect URLs, иначе Supabase подставит Site URL.
 */
async function siteOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
}

export async function login(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const next = nextPath(form);
  const failed = next === "/" ? "/login?error=credentials" : `${next}?error=credentials`;
  const email = String(form.get("email") ?? "").trim(),
    password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || !password || password.length > 1024)
    redirect(failed);
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  // Зарегистрировался, но не подтвердил email — к странице «откройте ссылку из письма».
  if (error?.code === "email_not_confirmed" && next === "/") {
    await rememberSignupEmail(email);
    redirect("/signup/verify?state=unconfirmed");
  }
  if (error) redirect(failed);
  // Пояснение «вышли по бездействию» больше не нужно.
  (await cookies()).delete(EXPIRED_COOKIE);
  revalidatePath("/", "layout");
  // Администратор Depter без своего магазина — сразу в админку.
  if (next === "/") {
    const admin = await db.rpc("am_i_platform_admin");
    if (admin.data === true) {
      const member = await db.from("organization_members").select("organization_id").limit(1);
      if (!member.data?.length) redirect("/admin");
    }
  }
  redirect(next);
}

/** Согласие с документами при регистрации: какая редакция и когда — в данных аккаунта (Supabase Auth). */
function consentRecord() {
  return { terms_version: LEGAL.version, terms_accepted_at: new Date().toISOString() };
}

/** Email, на который ушло письмо: страница /signup/verify берёт его отсюда, а не из адреса. */
async function rememberSignupEmail(email: string) {
  (await cookies()).set(SIGNUP_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

/**
 * Регистрация владельца: email и пароль → письмо со ссылкой
 * (/signup/verify ждёт, пока её откроют) → магазин на /onboarding. Кода доступа больше нет: новый
 * магазин получает бесплатный месяц (миграция open_signup).
 */
export async function signUp(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const email = String(form.get("email") ?? "").trim(),
    password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || password.length < 6 || password.length > 1024)
    redirect("/signup?error=invalid");
  if (form.get("accept") !== "1") redirect("/signup?error=consent");
  // Пришли по адресу вида бизнеса (/start/prokat) — запоминаем до создания магазина:
  // в куке (этот телефон) и в аккаунте (письмо открыли на другом).
  const business = String(form.get("business_type") ?? "");
  if (isBusinessType(business))
    (await cookies()).set(BUSINESS_COOKIE, business, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  const db = await createClient();
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/onboarding`,
      data: { ...consentRecord(), ...(isBusinessType(business) ? { business_type: business } : {}) },
    },
  });
  if (error) {
    if (error.status === 429) redirect("/signup?error=rate");
    redirect(`/signup?error=${error.message.toLowerCase().includes("disabled") ? "disabled" : "invalid"}`);
  }
  // Такой email уже подтверждён — Supabase не говорит прямо, но не даёт
  // ни одного способа входа (identities пуст). Отправляем ко входу.
  if (data.user && data.user.identities?.length === 0) redirect("/login?error=exists");
  if (!data.session) {
    await rememberSignupEmail(email);
    redirect("/signup/verify");
  }
  revalidatePath("/", "layout");
  redirect("/onboarding");
}

/**
 * Вход и регистрация через Google (включается GOOGLE_SIGNIN=1, см.
 * components/google-button.tsx). Google возвращает на /auth/confirm?code=…,
 * оттуда — на главную: есть магазин — в него, нет — на /onboarding. Тот же
 * email, что уже зарегистрирован паролем, Supabase связывает с аккаунтом сам.
 */
export async function signInWithGoogle(form: FormData) {
  if (!configured() || process.env.GOOGLE_SIGNIN !== "1") redirect("/login");
  const business = String(form.get("business_type") ?? "");
  if (isBusinessType(business))
    (await cookies()).set(BUSINESS_COOKIE, business, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  const db = await createClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/confirm?next=/`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    console.warn("signInWithGoogle:", error?.message);
    redirect("/login?error=google");
  }
  redirect(data.url);
}

/**
 * Вход через кнопку Google на самом depter.kg (components/google-identity.tsx):
 * Google отдаёт подтверждение входа (ID-токен) прямо странице, без перехода на
 * supabase.co, — поэтому в окне Google виден depter.kg. Supabase проверяет
 * токен (подпись, Client ID, nonce) и открывает сессию, как при обычном входе.
 */
export async function signInWithGoogleIdToken(token: string, nonce: string, business: string) {
  if (!configured() || process.env.GOOGLE_SIGNIN !== "1") redirect("/login");
  if (typeof token !== "string" || !token || token.length > 8192 || typeof nonce !== "string" || !/^[0-9a-f]{64}$/.test(nonce))
    redirect("/login?error=google");
  if (isBusinessType(business))
    (await cookies()).set(BUSINESS_COOKIE, business, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  const db = await createClient();
  const { error } = await db.auth.signInWithIdToken({ provider: "google", token, nonce });
  if (error) {
    console.warn("signInWithGoogleIdToken:", error.status, error.message);
    redirect("/login?error=google");
  }
  (await cookies()).delete(EXPIRED_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}

/** «Отправить письмо ещё раз». У Supabase лимит писем — тогда просим подождать. */
export async function resendSignup(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const store = await cookies();
  const email = String(form.get("email") ?? store.get(SIGNUP_EMAIL_COOKIE)?.value ?? "").trim();
  if (!email || email.length > 254 || !email.includes("@")) redirect("/signup/verify?error=email");
  await rememberSignupEmail(email);
  const db = await createClient();
  const { error } = await db.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/onboarding` },
  });
  if (error?.status === 429) redirect("/signup/verify?error=rate");
  if (error) console.warn("resendSignup:", error.status, error.message);
  redirect("/signup/verify?sent=1");
}

/** Другой email на странице подтверждения: забываем прежний и — к регистрации заново. */
export async function changeSignupEmail() {
  (await cookies()).delete(SIGNUP_EMAIL_COOKIE);
  redirect("/signup");
}

/**
 * Регистрация продавца по приглашению. Нужна включённая регистрация в
 * Supabase Auth. Если Supabase требует подтвердить email — сессии ещё нет:
 * просим подтвердить и открыть ссылку снова.
 */
export async function signUpByInvite(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{32}$/i.test(token)) redirect("/login");
  const back = `/join/${token}`;
  const email = String(form.get("email") ?? "").trim(),
    password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || password.length < 6 || password.length > 1024)
    redirect(`${back}?error=signup`);
  if (form.get("accept") !== "1") redirect(`${back}?error=consent`);
  // Аккаунт — только по действующему приглашению (саму регистрацию в
  // Supabase это не закрывает: она включается целиком, см. handover).
  const invite = await createAnonClient().rpc("get_invite", { p_token: token });
  if (invite.error) redirect(back);
  const db = await createClient();
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=${back}`, data: consentRecord() },
  });
  if (error) redirect(`${back}?error=${error.message.toLowerCase().includes("disabled") ? "signup_disabled" : "signup"}`);
  if (!data.session) redirect(`${back}?check=email`);
  const joined = await db.rpc("accept_invite", { p_token: token });
  if (joined.error) redirect(`${back}?error=accept`);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function acceptInvite(form: FormData) {
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{32}$/i.test(token)) redirect("/");
  const db = await createClient();
  const result = await db.rpc("accept_invite", { p_token: token });
  if (result.error)
    redirect(`/join/${token}?error=${result.error.message.includes("already_member") ? "member" : "accept"}`);
  revalidatePath("/", "layout");
  redirect("/");
}
export async function logout() {
  const db = await createClient();
  await db.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
export async function createOrganization(form: FormData) {
  const { db } = await getUserContext();
  const name = String(form.get("name") ?? "").trim();
  const key = String(form.get("key") ?? "");
  if (!name || name.length > 120 || !/^[-0-9a-f]{36}$/i.test(key))
    redirect("/onboarding?error=invalid");
  // Шаг первого входа (задача 35): имя продавца и телефон — для накладных.
  const sellerName = String(form.get("seller_name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const phone = storedPhone(String(form.get("phone") ?? ""));
  if (!sellerName || !phone || phone.length > 40) redirect("/onboarding?error=seller");
  // Пришёл через Google — согласие с документами ещё не записано: галочка на этой странице.
  const meta = (await db.auth.getClaims()).data?.claims?.user_metadata as { terms_version?: unknown } | undefined;
  if (!meta?.terms_version) {
    if (form.get("accept") !== "1") redirect("/onboarding?error=consent");
    const consent = await db.auth.updateUser({ data: consentRecord() });
    if (consent.error) console.error("createOrganization: consent not saved", consent.error.message);
  }
  const { data, error } = await db.rpc("create_organization", {
    org_name: name,
    request_key: key,
    // Без кода — бесплатный месяц (open_signup). Пилот без срока — дату стирает админ.
    signup_code: "",
  });
  // Магазин у аккаунта уже есть (форму отправили второй раз) — открываем его.
  if (error?.message.includes("shop_exists")) redirect("/");
  if (error || !data) redirect(`/onboarding?error=${error?.message.includes("invalid_code") ? "code" : "save"}`);
  // Базовая валюта (ТЗ §14.3: задаётся при регистрации) — пока записей нет,
  // база её меняет; сом — по умолчанию.
  const currency = String(form.get("currency") ?? "KGS");
  if (currency !== "KGS" && ["USD", "RUB"].includes(currency)) {
    const update = await db.from("organizations").update({ currency }).eq("id", data);
    if (update.error) console.error("createOrganization: currency not set", update.error);
  }
  // Телефон магазина — тот же; продавец — для накладной. Миграция 20261005100000
  // не применена — сохраняем хотя бы телефон.
  const seller = await db
    .from("organizations")
    .update({ phone, seller_name: sellerName, seller_phone: phone })
    .eq("id", data);
  if (seller.error) {
    console.error("createOrganization: seller not set", seller.error);
    await db.from("organizations").update({ phone }).eq("id", data);
  }
  // Вид бизнеса — разделы под него (src/lib/business.ts); не вышло — будет «Магазин».
  const type = String(form.get("business_type") ?? "");
  if (isBusinessType(type) && type !== DEFAULT_BUSINESS) {
    const profile = await db.rpc("set_business_profile", { p_org: data, p_type: type, p_overrides: [] });
    if (profile.error) console.error("createOrganization: business type not set", profile.error);
  }
  (await cookies()).delete(BUSINESS_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * «Забыли пароль?»: Supabase отправляет письмо со ссылкой на /auth/confirm
 * (адрес должен быть в Supabase → Authentication → URL Configuration →
 * Redirect URLs). Ответ одинаковый, есть такой email или нет, — чтобы по
 * форме нельзя было проверить, кто зарегистрирован.
 */
export async function requestPasswordReset(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const email = String(form.get("email") ?? "").trim();
  if (!email || email.length > 254 || !email.includes("@")) redirect("/forgot?error=email");
  const db = await createClient();
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/reset-password`,
  });
  // Лимит писем Supabase (несколько в час) — просим подождать; прочее не раскрываем.
  if (error?.status === 429) redirect("/forgot?error=rate");
  if (error) console.warn("requestPasswordReset:", error.status, error.message);
  redirect("/forgot?sent=1");
}

/** Новый пароль после ссылки из письма (сессия восстановления уже открыта). */
export async function updatePassword(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const password = String(form.get("password") ?? ""),
    repeat = String(form.get("repeat") ?? "");
  if (password.length < 6 || password.length > 1024) redirect("/reset-password?error=short");
  if (password !== repeat) redirect("/reset-password?error=mismatch");
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect("/forgot?error=link");
  const { error } = await db.auth.updateUser({ password });
  if (error)
    redirect(
      `/reset-password?error=${error.code === "same_password" ? "same" : error.code === "weak_password" ? "weak" : "failed"}`,
    );
  // Старый пароль мог знать кто-то ещё — его входы на других устройствах закрываем.
  await db.auth.signOut({ scope: "others" });
  revalidatePath("/", "layout");
  redirect("/?password=changed");
}
