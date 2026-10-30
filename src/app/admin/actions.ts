"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { adminSession, requirePlatformAdmin } from "@/lib/admin";
import { captchaFailed, captchaToken } from "@/lib/captcha";
import { EXPIRED_COOKIE } from "@/lib/session-timeout";
import { extendPaidUntil } from "@/lib/admin-people";
import { bishkekDate } from "@/lib/day-summary";
import { isBusinessType } from "@/lib/business";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shopPage = (org: string, done: string) => `/admin/shop/${org}?done=${done}`;

async function siteOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
}

/**
 * Вход на /admin: email и пароль (с проверкой «я не робот»), дальше — код
 * из приложения на /admin/mfa. Не админ — тот же ответ, что и неверный пароль,
 * и сразу выход: по форме не узнать, что пароль подошёл.
 */
export async function adminLogin(form: FormData) {
  const email = String(form.get("email") ?? "").trim(),
    password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || !password || password.length > 1024) redirect("/admin/login?error=credentials");
  const { db } = await adminSession();
  const { error } = await db.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken(form) } });
  if (captchaFailed(error)) redirect("/admin/login?error=captcha");
  if (error) redirect(`/admin/login?error=${error.status === 429 ? "rate" : "credentials"}`);
  if ((await db.rpc("am_i_platform_admin")).data !== true) {
    await db.auth.signOut({ scope: "local" });
    redirect("/admin/login?error=credentials");
  }
  (await cookies()).delete(EXPIRED_COOKIE);
  redirect("/admin/mfa");
}

/** Код из приложения: первый раз — подключение нового ключа, дальше — проверка. */
export async function verifyAdminCode(_state: { error: string } | null, form: FormData): Promise<{ error: string }> {
  const factorId = String(form.get("factor") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "code" };
  const { db, user, admin } = await adminSession();
  if (!user || !admin) redirect("/admin/login");
  // Вход («any»): код с любого подключённого телефона — у каждого свой ключ.
  const ids =
    factorId === "any"
      ? ((await db.auth.mfa.listFactors()).data?.totp ?? []).map((f) => f.id)
      : uuidPattern.test(factorId)
        ? [factorId]
        : [];
  if (!ids.length) return { error: "failed" };
  let error: { status?: number } | null = null;
  for (const id of ids) {
    ({ error } = await db.auth.mfa.challengeAndVerify({ factorId: id, code }));
    if (!error || error.status === 429) break;
  }
  if (error) return { error: error.status === 429 ? "rate" : "code" };
  revalidatePath("/admin", "layout");
  // Ещё один телефон из «Команды» — обратно туда.
  redirect(form.get("next") === "team" ? "/admin/team?done=key_added" : "/admin");
}

/** Отключить телефон со вторым ключом — свой и не последний (иначе не войти). */
export async function removeAdminKey(form: FormData) {
  const factorId = String(form.get("factor") ?? "");
  if (!uuidPattern.test(factorId)) redirect("/admin/team?error=key");
  const { db } = await requirePlatformAdmin();
  const keys = (await db.auth.mfa.listFactors()).data?.totp ?? [];
  if (!keys.some((k) => k.id === factorId)) redirect("/admin/team?error=key");
  if (keys.length <= 1) redirect("/admin/team?error=last_key");
  const { error } = await db.auth.mfa.unenroll({ factorId });
  if (error) {
    console.warn("removeAdminKey:", error.status, error.message);
    redirect("/admin/team?error=key");
  }
  revalidatePath("/admin/team");
  redirect("/admin/team?done=key_removed");
}

export async function adminLogout() {
  const { db } = await adminSession();
  await db.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/admin/login");
}

export async function createCode(form: FormData) {
  const note = String(form.get("note") ?? "").trim();
  if (!note || note.length > 200) redirect("/admin/codes?error=note");
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_create_code", { p_note: note });
  if (result.error || typeof result.data !== "string") redirect("/admin/codes?error=save");
  revalidatePath("/admin");
  redirect(`/admin/codes?created=${encodeURIComponent(result.data)}`);
}

export async function deleteCode(form: FormData) {
  const code = String(form.get("code") ?? "");
  if (!/^[0-9A-F]{10}$/.test(code)) redirect("/admin/codes?error=save");
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_delete_code", { p_code: code });
  if (result.error) redirect("/admin/codes?error=save");
  revalidatePath("/admin");
  redirect("/admin/codes?deleted=1");
}

export async function setPlan(form: FormData) {
  const org = String(form.get("org") ?? "");
  const plan = String(form.get("plan") ?? "");
  const paidUntil = String(form.get("paid_until") ?? "").trim();
  if (!uuidPattern.test(org)) redirect("/admin");
  if (!["basic", "business"].includes(plan) || (paidUntil && !/^\d{4}-\d{2}-\d{2}$/.test(paidUntil)))
    redirect(shopPage(org, "error"));
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_set_plan", { p_org: org, p_plan: plan, p_paid_until: paidUntil || null });
  if (result.error) redirect(shopPage(org, "error"));
  revalidatePath("/", "layout");
  redirect(shopPage(org, "plan"));
}

/** «Продлить пробный +7/+14 дней» и «Оплатил +1/+3 месяца» — от сегодня или от будущей даты. */
export async function extendShop(form: FormData) {
  const org = String(form.get("org") ?? "");
  const [kind, amount] = String(form.get("extend") ?? "").split(":");
  const n = Number(amount);
  if (!uuidPattern.test(org)) redirect("/admin");
  if (!["trial", "paid"].includes(kind) || ![7, 14, 1, 3].includes(n)) redirect(shopPage(org, "error"));
  const { db } = await requirePlatformAdmin();
  const shop = await db.rpc("admin_shop", { p_org: org });
  if (shop.error) redirect(shopPage(org, "error"));
  const current = (shop.data as { paid_until: string | null }).paid_until;
  const date = extendPaidUntil(current, bishkekDate(), kind === "trial" ? { days: n } : { months: n });
  const result = await db.rpc("admin_extend", { p_org: org, p_paid_until: date, p_paid: kind === "paid" });
  if (result.error) redirect(shopPage(org, "error"));
  revalidatePath("/", "layout");
  redirect(shopPage(org, kind === "trial" ? "trial" : "paid"));
}

export async function setBlocked(form: FormData) {
  const org = String(form.get("org") ?? "");
  const blocked = form.get("blocked") === "true";
  const reason = String(form.get("reason") ?? "").trim();
  if (!uuidPattern.test(org)) redirect("/admin");
  if (blocked && (!reason || reason.length > 300)) redirect(shopPage(org, "reason"));
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_set_blocked", { p_org: org, p_blocked: blocked, p_reason: blocked ? reason : null });
  if (result.error) redirect(shopPage(org, "error"));
  revalidatePath("/", "layout");
  redirect(shopPage(org, blocked ? "blocked" : "unblocked"));
}

export async function setShopBusiness(form: FormData) {
  const org = String(form.get("org") ?? "");
  const type = String(form.get("business_type") ?? "");
  if (!uuidPattern.test(org)) redirect("/admin");
  if (!isBusinessType(type)) redirect(shopPage(org, "error"));
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_set_business", { p_org: org, p_type: type === "shop" ? null : type });
  if (result.error) redirect(shopPage(org, "error"));
  revalidatePath("/", "layout");
  redirect(shopPage(org, "business"));
}

/** Куда вернуться после действия с человеком: страница магазина или аккаунта. */
function personBack(form: FormData) {
  const org = String(form.get("org") ?? ""),
    user = String(form.get("user") ?? "");
  if (uuidPattern.test(org)) return { org, user: null, page: `/admin/shop/${org}` };
  if (uuidPattern.test(user)) return { org: null, user, page: `/admin/account/${user}` };
  redirect("/admin");
}

export async function addNote(form: FormData) {
  const back = personBack(form);
  const body = String(form.get("body") ?? "").trim();
  const next = String(form.get("next_contact") ?? "").trim();
  if (!body || body.length > 2000 || (next && !/^\d{4}-\d{2}-\d{2}$/.test(next))) redirect(`${back.page}?done=note_error`);
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_add_note", { p_org: back.org, p_user: back.user, p_body: body, p_next: next || null });
  if (result.error) redirect(`${back.page}?done=note_error`);
  revalidatePath("/admin");
  redirect(`${back.page}?done=note#notes`);
}

/** Email человека — из базы, не из формы: письмо уходит только владельцу аккаунта. */
async function personEmail(db: Awaited<ReturnType<typeof requirePlatformAdmin>>["db"], back: { org: string | null; user: string | null }) {
  const result = back.org
    ? await db.rpc("admin_shop", { p_org: back.org })
    : await db.rpc("admin_account", { p_user: back.user });
  const data = result.data as { owner_email?: string | null; email?: string | null } | null;
  return (back.org ? data?.owner_email : data?.email) ?? null;
}

/** «Ссылка для смены пароля» — то же письмо, что «Забыли пароль?». */
export async function sendPasswordLink(form: FormData) {
  const back = personBack(form);
  const { db } = await requirePlatformAdmin();
  const email = await personEmail(db, back);
  if (!email) redirect(`${back.page}?done=mail_error`);
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/reset-password`,
    captchaToken: captchaToken(form),
  });
  if (error) {
    console.warn("sendPasswordLink:", error.status, error.code);
    redirect(`${back.page}?done=${captchaFailed(error) ? "captcha" : error.status === 429 ? "rate" : "mail_error"}`);
  }
  redirect(`${back.page}?done=password_link`);
}

/** «Письмо подтверждения ещё раз» — человеку, который не подтвердил почту. */
export async function resendConfirmation(form: FormData) {
  const back = personBack(form);
  const { db } = await requirePlatformAdmin();
  const email = await personEmail(db, back);
  if (!email) redirect(`${back.page}?done=mail_error`);
  const { error } = await db.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/onboarding`, captchaToken: captchaToken(form) },
  });
  if (error) {
    console.warn("resendConfirmation:", error.status, error.code);
    redirect(`${back.page}?done=${captchaFailed(error) ? "captcha" : error.status === 429 ? "rate" : "mail_error"}`);
  }
  redirect(`${back.page}?done=confirm_sent`);
}

export async function addAdmin(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  if (!email || email.length > 254 || !email.includes("@")) redirect("/admin/team?error=email");
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_add_admin", { p_email: email });
  if (result.error) {
    const code = ["no_account", "already_admin"].find((c) => result.error.message.includes(c)) ?? "save";
    redirect(`/admin/team?error=${code}`);
  }
  revalidatePath("/admin/team");
  redirect("/admin/team?done=added");
}

export async function removeAdmin(form: FormData) {
  const user = String(form.get("user") ?? "");
  if (!uuidPattern.test(user)) redirect("/admin/team");
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_remove_admin", { p_user: user });
  if (result.error) redirect(`/admin/team?error=${result.error.message.includes("cannot_remove_self") ? "self" : "save"}`);
  revalidatePath("/admin/team");
  redirect("/admin/team?done=removed");
}
