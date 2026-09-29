"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { recognizeDocument } from "@/lib/adre/recognize";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function retryRecognition(form: FormData) {
  const id = String(form.get("id") ?? "");
  const kind = String(form.get("kind") ?? "");
  const declared = form.get("declared_total");
  if (
    !uuidPattern.test(id) ||
    !["purchase", "sale", "payment", "expense"].includes(kind)
  )
    redirect("/documents?error=invalid");
  const { db, organizationId } = await getContext();
  after(() =>
    recognizeDocument({
      db,
      organizationId,
      documentId: id,
      kind: kind as "purchase" | "sale" | "payment" | "expense",
      declaredTotal: typeof declared === "string" && declared ? Number(declared) : null,
    }),
  );
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}?retried=1`);
}

export async function confirmDocument(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/documents?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("confirm_document_lines", {
    p_org: organizationId,
    p_document: id,
  });
  if (result.error) redirect(`/documents/${id}?error=confirm`);
  revalidatePath(`/documents/${id}`);
  redirect(`/documents/${id}?confirmed=1`);
}

export async function updateLine(form: FormData) {
  const id = String(form.get("line_id") ?? "");
  const documentId = String(form.get("document_id") ?? "");
  if (!uuidPattern.test(id) || !uuidPattern.test(documentId))
    redirect("/documents?error=invalid");
  const name = String(form.get("name_raw") ?? "").trim();
  const unit = String(form.get("unit") ?? "").trim() || "шт";
  let qty: string;
  let price: string;
  try {
    qty = decimalInput(form.get("qty"), 3);
    // Цена строки может быть отрицательной — скидка («Скидка», 1 × -200).
    const rawPrice = String(form.get("price") ?? "").trim();
    const negative = /^[-−–]/.test(rawPrice);
    price = decimalInput(rawPrice.replace(/^[-−–]\s*/, ""), 2);
    if (negative && Number(price) !== 0) price = `-${price}`;
  } catch {
    redirect(`/documents/${documentId}?error=line`);
  }
  if (!name || name.length > 200) redirect(`/documents/${documentId}?error=line`);
  const { db } = await getContext();
  const result = await db
    .from("document_lines")
    .update({ name_raw: name, unit, qty, price })
    .eq("id", id);
  if (result.error) redirect(`/documents/${documentId}?error=line`);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?saved=1`);
}

export async function saveAlias(form: FormData) {
  const kind = String(form.get("kind") ?? "");
  const partyId = String(form.get("party_id") ?? "");
  const alias = String(form.get("alias") ?? "").trim();
  const documentId = String(form.get("document_id") ?? "");
  if (
    !["customer", "supplier"].includes(kind) ||
    !uuidPattern.test(partyId) ||
    !uuidPattern.test(documentId) ||
    !alias
  )
    redirect(`/documents/${documentId}?error=alias`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("add_counterparty_alias", {
    p_org: organizationId,
    p_kind: kind,
    p_id: partyId,
    p_alias: alias,
  });
  if (result.error) redirect(`/documents/${documentId}?error=alias`);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?aliasSaved=1`);
}

/** Цена строки: с минусом — скидка/возврат (как в updateLine). */
function linePrice(raw: FormDataEntryValue | null): string {
  const text = String(raw ?? "").trim();
  const negative = /^[-−–]/.test(text);
  const price = decimalInput(text.replace(/^[-−–]\s*/, ""), 2);
  return negative && Number(price) !== 0 ? `-${price}` : price;
}

/** Ввести позицию вручную (аудит ТЗ 15.1 п. 17, ТЗ §6). */
export async function addLine(form: FormData) {
  const documentId = String(form.get("document_id") ?? "");
  if (!uuidPattern.test(documentId)) redirect("/documents?error=invalid");
  const name = String(form.get("name_raw") ?? "").trim();
  let qty: string;
  let price: string;
  try {
    qty = decimalInput(form.get("qty"), 3);
    price = linePrice(form.get("price"));
  } catch {
    redirect(`/documents/${documentId}?error=line`);
  }
  if (!name || name.length > 200 || Number(qty) <= 0) redirect(`/documents/${documentId}?error=line`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("add_document_line", {
    p_org: organizationId,
    p_document: documentId,
    p_name: name,
    p_qty: qty,
    p_unit: String(form.get("unit") ?? "").trim() || "шт",
    p_price: price,
  });
  if (result.error) redirect(`/documents/${documentId}?error=line`);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?saved=1`);
}

export async function deleteLine(form: FormData) {
  const documentId = String(form.get("document_id") ?? "");
  const lineId = String(form.get("line_id") ?? "");
  if (!uuidPattern.test(documentId) || !uuidPattern.test(lineId)) redirect("/documents?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("delete_document_line", { p_org: organizationId, p_line: lineId });
  if (result.error) redirect(`/documents/${documentId}?error=line`);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?saved=1`);
}
