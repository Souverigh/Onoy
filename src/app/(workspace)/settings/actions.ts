"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireOwner } from "@/lib/context";

export async function updateShop(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const blockDuplicatePhotos = form.get("block_duplicate_photos") === "on";
  if (!name || name.length > 120 || phone.length > 40)
    redirect("/settings?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db
    .from("organizations")
    .update({ name, phone, block_duplicate_photos: blockDuplicatePhotos })
    .eq("id", organizationId);
  if (result.error) redirect("/settings?error=save");
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
