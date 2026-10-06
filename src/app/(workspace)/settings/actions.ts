"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getContext, getUserContext, requireOwner } from "@/lib/context";
import { storedPhone } from "@/lib/contacts";

/** Картинка QR для оплаты — в data URL до ~300 КБ (колонка pay_qr_image). */
async function qrImage(file: File): Promise<string | null> {
  if (file.size > 4 * 1024 * 1024 || !file.type.startsWith("image/")) return null;
  try {
    const sharp = (await import("sharp")).default;
    const png = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    const url = `data:image/png;base64,${png.toString("base64")}`;
    return url.length <= 400000 ? url : null;
  } catch {
    return null;
  }
}

const field = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function updateShop(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const phone = storedPhone(String(form.get("phone") ?? ""));
  // Продавец, адрес и реквизиты (задача 34) — только если поля есть в форме.
  const sellerFields = form.has("seller_name");
  const details: Record<string, string | boolean | null> = sellerFields
    ? {
        seller_name: field(form, "seller_name", 80),
        seller_phone: storedPhone(field(form, "seller_phone", 40)),
        address: field(form, "address", 200),
        pay_mbank: field(form, "pay_mbank", 60),
        pay_optima: field(form, "pay_optima", 60),
        pay_odengi: field(form, "pay_odengi", 60),
        invoice_show_debt: form.get("invoice_show_debt") === "on",
        invoice_show_qr: form.get("invoice_show_qr") === "on",
      }
    : {};
  const qrFile = form.get("pay_qr");
  if (qrFile instanceof File && qrFile.size > 0) {
    const url = await qrImage(qrFile);
    if (!url) redirect("/settings?error=qr#pay");
    details.pay_qr_image = url;
  } else if (form.get("pay_qr_remove") === "on") details.pay_qr_image = null;
  const blockDuplicatePhotos = form.get("block_duplicate_photos") === "on";
  const currency = String(form.get("currency") ?? "");
  // Как магазин написан на накладных — по строке на вариант (classify.ts).
  const documentNames = [
    ...new Set(
      String(form.get("document_names") ?? "")
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ];
  if (
    !name ||
    name.length > 120 ||
    phone.length > 40 ||
    documentNames.length > 20 ||
    documentNames.some((n) => n.length > 120)
  )
    redirect("/settings?error=invalid");
  const { db, organizationId, currency: currentCurrency } = await getContext();
  const base = {
    name,
    phone,
    block_duplicate_photos: blockDuplicatePhotos,
    document_names: documentNames,
    // Валюту трогаем, только если сменили: с записями база её не меняет.
    ...(["KGS", "USD", "RUB"].includes(currency) && currency !== currentCurrency ? { currency } : {}),
  };
  let result = await db
    .from("organizations")
    .update({ ...base, ...details })
    .eq("id", organizationId);
  // Миграция 20261005100000 ещё не применена — сохраняем хотя бы остальное.
  if (result.error && Object.keys(details).length && /column|schema/i.test(result.error.message)) {
    result = await db.from("organizations").update(base).eq("id", organizationId);
    if (!result.error) {
      revalidatePath("/", "layout");
      redirect("/settings?error=migration");
    }
  }
  if (result.error)
    redirect(`/settings?error=${result.error.message.includes("currency_locked") ? "currency_locked" : "save"}`);
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Приглашение продавца: одноразовая ссылка на 7 дней (только владелец). */
export async function createInvite(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) redirect("/settings?staff=name#staff");
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("create_invite", { p_org: organizationId, p_name: name });
  if (result.error)
    redirect(
      `/settings?staff=${
        result.error.message.includes("staff_limit")
          ? "limit"
          : result.error.message.includes("business_plan")
            ? "plan"
            : "error"
      }#staff`,
    );
  revalidatePath("/settings");
  redirect("/settings?staff=invited#staff");
}

export async function revokeInvite(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/settings?staff=error#staff");
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("revoke_invite", { p_org: organizationId, p_invite: id });
  if (result.error) redirect("/settings?staff=error#staff");
  revalidatePath("/settings");
  redirect("/settings?staff=revoked#staff");
}

export async function removeMember(form: FormData) {
  const userId = String(form.get("user_id") ?? "");
  if (!uuidPattern.test(userId)) redirect("/settings?staff=error#staff");
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("remove_member", { p_org: organizationId, p_user: userId });
  if (result.error) redirect("/settings?staff=error#staff");
  revalidatePath("/", "layout");
  redirect("/settings?staff=removed#staff");
}

export async function renameMember(form: FormData) {
  const userId = String(form.get("user_id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!uuidPattern.test(userId) || !name || name.length > 80) redirect("/settings?staff=name#staff");
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("rename_member", { p_org: organizationId, p_user: userId, p_name: name });
  if (result.error) redirect("/settings?staff=error#staff");
  revalidatePath("/", "layout");
  redirect("/settings?staff=renamed#staff");
}

const accountBack = (code: string) => `/settings?account=${code}#account`;

/**
 * Смена пароля: сначала текущий пароль (вход им же — так Supabase считает
 * вход свежим и разрешает смену), потом новый. Другие устройства выходят.
 */
export async function changePassword(form: FormData) {
  const current = String(form.get("current") ?? ""),
    password = String(form.get("password") ?? ""),
    repeat = String(form.get("repeat") ?? "");
  if (!current || current.length > 1024) redirect(accountBack("current"));
  if (password.length < 6 || password.length > 1024) redirect(accountBack("short"));
  if (password !== repeat) redirect(accountBack("mismatch"));
  if (password === current) redirect(accountBack("same"));
  const { db, user } = await getUserContext();
  if (!user.email) redirect(accountBack("failed"));
  const check = await db.auth.signInWithPassword({ email: user.email, password: current });
  if (check.error) redirect(accountBack(check.error.status === 429 ? "rate" : "current"));
  const { error } = await db.auth.updateUser({ password });
  if (error) {
    console.warn("changePassword:", error.status, error.code);
    redirect(
      accountBack(error.code === "same_password" ? "same" : error.code === "weak_password" ? "weak" : "failed"),
    );
  }
  await db.auth.signOut({ scope: "others" });
  redirect(accountBack("password_changed"));
}

/**
 * Смена email: подтверждаем текущим паролем, Supabase шлёт ссылку на новый
 * адрес (и на старый, если включено «Secure email change»). Ссылка ведёт на
 * /auth/confirm → обратно в настройки. До подтверждения вход — по старому.
 */
export async function changeEmail(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase(),
    current = String(form.get("current") ?? "");
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(accountBack("email_invalid"));
  if (!current || current.length > 1024) redirect(accountBack("email_current"));
  const { db, user } = await getUserContext();
  if (!user.email) redirect(accountBack("failed"));
  if (email === user.email.toLowerCase()) redirect(accountBack("email_same"));
  const check = await db.auth.signInWithPassword({ email: user.email, password: current });
  if (check.error) redirect(accountBack(check.error.status === 429 ? "rate" : "email_current"));
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const { error } = await db.auth.updateUser({ email }, { emailRedirectTo: `${origin}/auth/confirm?next=/settings` });
  if (error) {
    console.warn("changeEmail:", error.status, error.code);
    redirect(
      accountBack(
        error.status === 429
          ? "rate"
          : error.code === "email_exists"
            ? "email_taken"
            : error.code === "email_address_invalid"
              ? "email_invalid"
              : "failed",
      ),
    );
  }
  redirect(`/settings?account=email_sent&to=${encodeURIComponent(email)}#account`);
}
