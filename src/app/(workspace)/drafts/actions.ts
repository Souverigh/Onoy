"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { draftData, type DraftData, type DraftKind } from "@/lib/drafts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Автосохранение формы продажи/прихода товарами. Без id — новый черновик.
 * «gone» — черновик уже записан или стёрт: форма перестаёт его сохранять.
 */
export async function saveDraft(
  kind: DraftKind,
  id: string | null,
  data: DraftData,
): Promise<{ id: string } | { error: "gone" | "save" }> {
  if (kind !== "sale" && kind !== "purchase") return { error: "save" };
  if (id && !uuidPattern.test(id)) return { error: "gone" };
  const { db, organizationId } = await getContext();
  const result = await db.rpc("save_record_draft", {
    p_org: organizationId,
    p_id: id,
    p_kind: kind,
    p_data: draftData(data),
  });
  if (result.error || !result.data) {
    if (result.error?.message.includes("draft_gone")) return { error: "gone" };
    console.error("saveDraft failed", { message: result.error?.message });
    return { error: "save" };
  }
  return { id: result.data as string };
}

/** Стереть черновик из списка «Продажи» / «Приход». */
export async function deleteDraft(form: FormData) {
  const id = form.get("id");
  const kind = form.get("kind") === "purchase" ? "purchase" : "sale";
  const back = kind === "sale" ? "/sales" : "/purchases";
  if (typeof id !== "string" || !uuidPattern.test(id)) redirect(back);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("delete_record_draft", { p_org: organizationId, p_id: id });
  if (result.error) {
    console.error("deleteDraft failed", { message: result.error.message });
    redirect(`${back}?error=draft`);
  }
  revalidatePath(back);
  redirect(`${back}?deleted=1`);
}
