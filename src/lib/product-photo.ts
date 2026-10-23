/**
 * Фото товара (миграция product_photos.sql): публичное хранилище
 * product-photos, путь «<магазин>/<товар>/<случайный>.jpg». Адрес открывается
 * без входа — для каталога клиентов.
 */
export const PRODUCT_PHOTO_BUCKET = "product-photos";

/** Длинная сторона фото товара: в каталоге хватает, грузится быстро. */
export const PRODUCT_PHOTO_SIDE = 1000;

/**
 * Миниатюра для списков (~10 КБ вместо ~150): рядом с фото, тот же путь с
 * «-t.jpg». Полное фото грузится только при просмотре крупно.
 */
export const PRODUCT_THUMB_SIDE = 160;
export const thumbPath = (path: string) => path.replace(/\.[a-z]+$/i, "") + "-t.jpg";

/** Как ограничение хранилища: 2 МБ, только JPEG / PNG / WebP. */
export const PRODUCT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function productThumbUrl(path: string | null | undefined): string | null {
  return path ? productPhotoUrl(thumbPath(path)) : null;
}

export function productPhotoUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/${PRODUCT_PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
