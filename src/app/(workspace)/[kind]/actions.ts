"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { isDirectory, directoryInput } from "@/lib/validation";
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
