"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { isDirectory, directoryInput } from "@/lib/validation";

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
