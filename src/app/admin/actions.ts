"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!uuidPattern.test(org) || !["basic", "business"].includes(plan) || (paidUntil && !/^\d{4}-\d{2}-\d{2}$/.test(paidUntil)))
    redirect("/admin?error=save");
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_set_plan", { p_org: org, p_plan: plan, p_paid_until: paidUntil || null });
  if (result.error) redirect("/admin?error=save");
  revalidatePath("/", "layout");
  redirect(`/admin?saved=${org}#shop-${org}`);
}

export async function setBlocked(form: FormData) {
  const org = String(form.get("org") ?? "");
  const blocked = form.get("blocked") === "true";
  const reason = String(form.get("reason") ?? "").trim();
  if (!uuidPattern.test(org) || (blocked && (!reason || reason.length > 300))) redirect("/admin?error=reason");
  const { db } = await requirePlatformAdmin();
  const result = await db.rpc("admin_set_blocked", { p_org: org, p_blocked: blocked, p_reason: blocked ? reason : null });
  if (result.error) redirect("/admin?error=save");
  revalidatePath("/", "layout");
  redirect(`/admin?saved=${org}#shop-${org}`);
}
