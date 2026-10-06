import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Удаление после «Удалено · Вернуть» (задача 29): окно Depter спросило, 10
 * секунд можно было вернуть — теперь удаляем. Зовётся fetch или sendBeacon
 * (если продавец ушёл со страницы раньше). Все проверки — в функциях базы.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const what = String(form.get("what") ?? "");
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { db, organizationId } = await getContext();
  const result =
    what === "document"
      ? await db.rpc("delete_unused_document", { p_org: organizationId, p_document: id })
      : what === "line"
        ? await db.rpc("delete_document_line", { p_org: organizationId, p_line: id })
        : what === "customers" || what === "suppliers"
          ? await db.rpc("delete_party", { p_org: organizationId, p_kind: what, p_id: id })
          : null;
  if (!result) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (result.error) {
    const message = result.error.message;
    const code = /has_records|document_in_use/.test(message) ? "in_use" : message.includes("owner_only") ? "owner_only" : "failed";
    return NextResponse.json({ error: code }, { status: 409 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}
