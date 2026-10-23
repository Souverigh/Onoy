import { shrinkImage } from "./shrink-image";
import { PRODUCT_PHOTO_MAX_BYTES, PRODUCT_PHOTO_SIDE, PRODUCT_PHOTO_TYPES, PRODUCT_THUMB_SIDE } from "./product-photo";
import { setProductPhoto, type ProductPhotoResult } from "@/app/(workspace)/stock/photo-actions";

/** Тексты ошибок загрузки фото товара — одни и те же в карточке и в списке каталога. */
export const PRODUCT_PHOTO_ERROR = {
  type: "Этот формат фото не подходит. Сфотографируйте заново или выберите JPG / PNG.",
  size: "Фото слишком большое. Выберите другое.",
  save: "Не удалось сохранить фото. Проверьте интернет и попробуйте ещё раз.",
} as const;

/**
 * Фото товара из браузера: ужать (полное ~1000 px и миниатюра ~160 px) и
 * сразу сохранить. Только для клиентских компонентов.
 */
export async function uploadProductPhoto(productId: string, file: File): Promise<ProductPhotoResult> {
  const [shrunk, thumb] = await Promise.all([
    shrinkImage(file, PRODUCT_PHOTO_SIDE),
    // Миниатюра для списков каталога: ~10 КБ, клиенту — меньше трафика.
    shrinkImage(file, PRODUCT_THUMB_SIDE),
  ]);
  if (!PRODUCT_PHOTO_TYPES.includes(shrunk.type)) return { error: "type" };
  if (shrunk.size > PRODUCT_PHOTO_MAX_BYTES) return { error: "size" };
  const form = new FormData();
  form.set("product_id", productId);
  form.set("photo", shrunk);
  if (thumb.type === "image/jpeg" && thumb.size < shrunk.size) form.set("thumb", thumb);
  try {
    return await setProductPhoto(form);
  } catch {
    return { error: "save" };
  }
}

/** Убрать фото товара. */
export async function removeProductPhoto(productId: string): Promise<ProductPhotoResult> {
  const form = new FormData();
  form.set("product_id", productId);
  form.set("remove", "1");
  try {
    return await setProductPhoto(form);
  } catch {
    return { error: "save" };
  }
}
