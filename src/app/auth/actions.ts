"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, configured } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/context";
export async function login(form: FormData) {
  if (!configured()) redirect("/login?error=setup");
  const email = String(form.get("email") ?? "").trim(),
    password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || !password || password.length > 1024)
    redirect("/login?error=credentials");
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=credentials");
  revalidatePath("/", "layout");
  redirect("/");
}
export async function logout() {
  const db = await createClient();
  await db.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
export async function createOrganization(form: FormData) {
  const { db } = await getUserContext();
  const name = String(form.get("name") ?? "").trim();
  const key = String(form.get("key") ?? "");
  if (!name || name.length > 120 || !/^[-0-9a-f]{36}$/i.test(key))
    redirect("/onboarding?error=invalid");
  const { data, error } = await db.rpc("create_organization", {
    org_name: name,
    request_key: key,
  });
  if (error || !data) redirect("/onboarding?error=save");
  revalidatePath("/", "layout");
  redirect("/");
}
