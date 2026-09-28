"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireOwner } from "@/lib/context";
import { isDirectory, directoryInput } from "@/lib/validation";
import { promisedDateInput } from "@/lib/promise";
import { bishkekDate } from "@/lib/day-summary";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveEntry(form: FormData) {
  const kind = String(form.get("kind"));
  if (!isDirectory(kind)) throw new Error("Неизвестный справочник");
  const { db, organizationId } = await getContext();
  const id = String(form.get("id") ?? "");
  if (id && !/^[a-f0-9-]{36}$/i.test(id))
    throw new Error("Неверный идентификатор");
  let input;
  try {
    input = directoryInput(kind, Object.fromEntries(form));
  } catch {
    redirect(`/${kind}/${id || "new"}?error=invalid`);
  }
  const result = id
    ? await db
        .from(kind)
        .update(input)
        .eq("organization_id", organizationId)
        .eq("id", id)
        .select("id")
        .single()
    : await db
        .from(kind)
        .insert({ ...input, organization_id: organizationId })
        .select("id")
        .single();
  if (result.error || !result.data)
    redirect(
      `/${kind}/${id || "new"}?error=${result.error?.code === "23505" ? "duplicate" : "save"}`,
    );
  revalidatePath("/", "layout");
  redirect(`/${kind}/${result.data.id}?saved=1`);
}

export async function createLink(form: FormData) {
  const customerId = String(form.get("customer_id") ?? "");
  if (!uuidPattern.test(customerId)) redirect("/customers?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("create_share_link", {
    p_org: organizationId,
    p_customer: customerId,
  });
  if (result.error) redirect(`/customers/${customerId}?error=link`);
  revalidatePath("/", "layout");
  redirect(`/customers/${customerId}?linked=1`);
}

export async function revokeLink(form: FormData) {
  const customerId = String(form.get("customer_id") ?? "");
  const linkId = String(form.get("link_id") ?? "");
  if (!uuidPattern.test(customerId) || !uuidPattern.test(linkId))
    redirect("/customers?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("revoke_share_link", {
    p_org: organizationId,
    p_link: linkId,
  });
  if (result.error) redirect(`/customers/${customerId}?error=link`);
  revalidatePath("/", "layout");
  redirect(`/customers/${customerId}?revoked=1`);
}

/** Обещанная дата оплаты: пусто — убрать; прошлое и дальше года — ошибка. */
export async function setPromisedDate(form: FormData) {
  const customerId = String(form.get("customer_id") ?? "");
  if (!uuidPattern.test(customerId)) redirect("/customers?error=invalid");
  const promised = promisedDateInput(String(form.get("promised_date") ?? ""), bishkekDate());
  if (promised === undefined) redirect(`/customers/${customerId}?error=promise`);
  const { db, organizationId } = await getContext();
  const result = await db
    .from("customers")
    .update({ promised_date: promised })
    .eq("organization_id", organizationId)
    .eq("id", customerId);
  if (result.error) redirect(`/customers/${customerId}?error=promise`);
  revalidatePath("/", "layout");
  redirect(`/customers/${customerId}?promised=${promised ? "1" : "0"}`);
}

/** Удалить / в архив / вернуть / объединить контрагента (ТЗ §15.2). */
function partyKind(form: FormData) {
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");
  if ((kind !== "customers" && kind !== "suppliers") || !uuidPattern.test(id)) redirect("/customers?error=invalid");
  return { kind, id };
}

export async function deleteParty(form: FormData) {
  const { kind, id } = partyKind(form);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("delete_party", { p_org: organizationId, p_kind: kind, p_id: id });
  if (result.error)
    redirect(`/${kind}/${id}?error=${result.error.message.includes("has_records") ? "has_records" : "party"}`);
  revalidatePath("/", "layout");
  redirect(`/${kind}?deleted=1`);
}

export async function setArchived(form: FormData) {
  const { kind, id } = partyKind(form);
  const archived = form.get("archived") === "true";
  const { db, organizationId } = await getContext();
  const result = await db.rpc("set_party_archived", { p_org: organizationId, p_kind: kind, p_id: id, p_archived: archived });
  if (result.error) redirect(`/${kind}/${id}?error=party`);
  revalidatePath("/", "layout");
  redirect(`/${kind}/${id}?${archived ? "archived" : "restored"}=1`);
}

export async function mergeParty(form: FormData) {
  const { kind, id } = partyKind(form);
  const into = String(form.get("into") ?? "");
  if (!uuidPattern.test(into) || into === id) redirect(`/${kind}/${id}?error=merge`);
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("merge_party", { p_org: organizationId, p_kind: kind, p_from: id, p_into: into });
  if (result.error)
    redirect(`/${kind}/${id}?error=${result.error.message.includes("opening_conflict") ? "merge_opening" : "merge"}`);
  revalidatePath("/", "layout");
  redirect(`/${kind}/${into}?merged=1`);
}

export async function undoMerge(form: FormData) {
  const { kind, id } = partyKind(form);
  const merge = String(form.get("merge") ?? "");
  if (!uuidPattern.test(merge)) redirect(`/${kind}/${id}?error=merge`);
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("undo_merge", { p_org: organizationId, p_merge: merge });
  if (result.error) redirect(`/${kind}/${id}?error=merge_expired`);
  revalidatePath("/", "layout");
  redirect(`/${kind}/${id}?unmerged=1`);
}
