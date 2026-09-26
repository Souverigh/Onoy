"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

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
