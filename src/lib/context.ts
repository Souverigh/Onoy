import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, configured } from "./supabase/server";
export const getUserContext = cache(async () => {
  if (!configured()) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { db, user: data.user };
});
export const getContext = cache(async () => {
  const { db, user } = await getUserContext();
  const { data, error } = await db
    .from("organization_members")
    .select("organization_id,organizations(name)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(
      "Не удалось открыть организацию. Проверьте подключение базы.",
    );
  if (!data) redirect("/onboarding");
  const org = data.organizations as unknown as { name: string };
  return {
    db,
    user,
    organizationId: data.organization_id as string,
    organizationName: org.name,
  };
});
