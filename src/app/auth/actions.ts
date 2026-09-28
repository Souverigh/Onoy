"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAnonClient, createClient, configured } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/context";
/** Куда вернуть после входа: только страница приглашения, иначе главная. */
function nextPath(form: FormData) {
  const next = String(form.get("next") ?? "");
  return /^\/join\/[a-f0-9]{32}$/i.test(next) ? next : "/";
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
  if (error) redirect(failed);
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

/**
 * Регистрация нового владельца магазина. Магазин он создаст на /onboarding —
 * только с кодом доступа от Depter. Нужна включённая регистрация в Supabase.
 */
export async function signUp(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const email = String(form.get("email") ?? "").trim(),
    password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || password.length < 6 || password.length > 1024)
    redirect("/signup?error=invalid");
  const db = await createClient();
  const { data, error } = await db.auth.signUp({ email, password });
  if (error)
    redirect(`/signup?error=${error.message.toLowerCase().includes("disabled") ? "disabled" : "invalid"}`);
  if (!data.session) redirect("/signup?check=email");
  revalidatePath("/", "layout");
  redirect("/onboarding");
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
  // Аккаунт — только по действующему приглашению (саму регистрацию в
  // Supabase это не закрывает: она включается целиком, см. handover).
  const invite = await createAnonClient().rpc("get_invite", { p_token: token });
  if (invite.error) redirect(back);
  const db = await createClient();
  const { data, error } = await db.auth.signUp({ email, password });
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
  const code = String(form.get("code") ?? "").trim();
  if (!name || name.length > 120 || !/^[-0-9a-f]{36}$/i.test(key))
    redirect("/onboarding?error=invalid");
  if (!code || code.length > 40) redirect("/onboarding?error=code");
  // Новый магазин — только с кодом доступа от Depter (см. миграцию shop_signup_codes).
  const { data, error } = await db.rpc("create_organization", {
    org_name: name,
    request_key: key,
    signup_code: code,
  });
  if (error || !data) redirect(`/onboarding?error=${error?.message.includes("invalid_code") ? "code" : "save"}`);
  // Базовая валюта (ТЗ §14.3: задаётся при регистрации) — пока записей нет,
  // база её меняет; сом — по умолчанию.
  const currency = String(form.get("currency") ?? "KGS");
  if (currency !== "KGS" && ["USD", "RUB"].includes(currency)) {
    const update = await db.from("organizations").update({ currency }).eq("id", data);
    if (update.error) console.error("createOrganization: currency not set", update.error);
  }
  revalidatePath("/", "layout");
  redirect("/");
}
