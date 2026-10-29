import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getContext } from "@/lib/context";

/** Сторона миниатюры: в списке 86px, вдвое — для чётких экранов телефонов. */
const SIDE = 172;

/**
 * Миниатюра первой страницы документа для списка «Документы» (29.10.2026):
 * вместо целого фото (сотни КБ) — маленький JPEG, и по постоянному адресу,
 * чтобы браузер не качал его снова после «Показать ещё 10». Фото документа не
 * меняется, поэтому кэш долгий; доступ — только своему магазину. PDF — 404,
 * список показывает «PDF».
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { db, organizationId } = await getContext();
  const doc = await db
    .from("documents")
    .select("storage_path,mime_type")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (doc.error || !doc.data || doc.data.mime_type === "application/pdf")
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const file = await db.storage.from("receipts").download(doc.data.storage_path);
  if (file.error || !file.data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const thumb = await sharp(Buffer.from(await file.data.arrayBuffer()))
      .rotate()
      .resize(SIDE, SIDE, { fit: "cover", position: "top" })
      .jpeg({ quality: 70 })
      .toBuffer();
    return new NextResponse(new Uint8Array(thumb), {
      headers: {
        "Content-Type": "image/jpeg",
        // Только этому браузеру (за входом), неделю.
        "Cache-Control": "private, max-age=604800, immutable",
      },
    });
  } catch (error) {
    console.error("Document thumbnail failed", error);
    return NextResponse.json({ error: "bad_image" }, { status: 415 });
  }
}
