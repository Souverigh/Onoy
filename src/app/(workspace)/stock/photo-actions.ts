"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getContext } from "@/lib/context";
import {
  PRODUCT_PHOTO_BUCKET,
  PRODUCT_PHOTO_MAX_BYTES,
  PRODUCT_PHOTO_TYPES,
  productPhotoUrl,
  productThumbUrl,
  thumbPath,
} from "@/lib/product-photo";
import { refreshCatalog } from "@/lib/catalog-cache";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductPhotoResult = { url: string | null; thumb: string | null } | { error: "type" | "size" | "save" };

/**
 * Фото товара: поставить новое (поле photo) или убрать (remove=1). Фото уже
 * ужато в браузере. Прежний файл удаляем из хранилища после записи пути —
 * не вышло удалить — только лог, товар уже с новым фото.
 */
export async function setProductPhoto(form: FormData): Promise<ProductPhotoResult> {
  try {
    const productId = String(form.get("product_id") ?? "");
    if (!uuidPattern.test(productId)) return { error: "save" };
    const { db, organizationId } = await getContext();
    const remove = form.get("remove") === "1";
    let path: string | null = null;
    if (!remove) {
      const file = form.get("photo");
      if (!(file instanceof File) || file.size === 0) return { error: "save" };
      if (!PRODUCT_PHOTO_TYPES.includes(file.type)) return { error: "type" };
      if (file.size > PRODUCT_PHOTO_MAX_BYTES) return { error: "size" };
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      path = `${organizationId}/${productId}/${randomUUID()}.${ext}`;
      // Путь у каждого фото свой — файл не меняется, браузер и CDN держат его год.
      const upload = await db.storage
        .from(PRODUCT_PHOTO_BUCKET)
        .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, cacheControl: "31536000" });
      if (upload.error) {
        console.error("setProductPhoto: upload failed", { message: upload.error.message });
        return { error: "save" };
      }
      // Миниатюра (если браузер смог её сделать): не вышло — каталог покажет полное фото.
      const thumb = form.get("thumb");
      if (thumb instanceof File && thumb.size > 0 && thumb.type === "image/jpeg" && thumb.size <= PRODUCT_PHOTO_MAX_BYTES) {
        const small = await db.storage
          .from(PRODUCT_PHOTO_BUCKET)
          .upload(thumbPath(path), Buffer.from(await thumb.arrayBuffer()), { contentType: "image/jpeg", cacheControl: "31536000" });
        if (small.error) console.error("setProductPhoto: thumb upload failed", { message: small.error.message });
      }
    }
    const saved = await db.rpc("set_product_photo", { p_org: organizationId, p_product: productId, p_path: path });
    if (saved.error) {
      console.error("setProductPhoto: set_product_photo failed", { message: saved.error.message });
      if (path) await db.storage.from(PRODUCT_PHOTO_BUCKET).remove([path, thumbPath(path)]);
      return { error: "save" };
    }
    const old = typeof saved.data === "string" ? saved.data : null;
    if (old && old !== path) {
      const removed = await db.storage.from(PRODUCT_PHOTO_BUCKET).remove([old, thumbPath(old)]);
      if (removed.error) console.error("setProductPhoto: old photo not removed", { message: removed.error.message });
    }
    revalidatePath(`/stock/${productId}`);
    revalidatePath("/stock/catalog");
    await refreshCatalog(db, organizationId);
    return { url: productPhotoUrl(path), thumb: productThumbUrl(path) };
  } catch (error) {
    unstable_rethrow(error);
    console.error("setProductPhoto: unexpected failure", error);
    return { error: "save" };
  }
}
