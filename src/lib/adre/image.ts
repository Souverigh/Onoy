import "server-only";
import sharp from "sharp";
import type { PhotoPage, TopSide } from "./types";

/** Поворот по часовой, чтобы верх документа оказался сверху. */
const ROTATION: Record<TopSide, number> = { top: 0, right: 270, bottom: 180, left: 90 };

export function isImage(page: PhotoPage) {
  return page.mimeType.startsWith("image/");
}

/**
 * Фото, снятое боком или вверх ногами (ТЗ §15.5 P0): модель читает его
 * хуже — названия съезжают на соседние строки, цифры подгоняются. Поворот
 * по EXIF делает браузер при сжатии (shrink-image.ts), здесь — по тому, где
 * модель увидела верх документа.
 */
export async function uprightPage(page: PhotoPage, topSide: TopSide): Promise<PhotoPage> {
  const degrees = ROTATION[topSide];
  if (!degrees || !isImage(page)) return page;
  const photo = await sharp(page.photo).rotate().rotate(degrees).jpeg({ quality: 90 }).toBuffer();
  return { photo, mimeType: "image/jpeg" };
}

/**
 * Длинная накладная — по половинам: каждая половина в том же разрешении
 * запроса получает вдвое больше точек на строку. Половины перекрываются,
 * чтобы строка на стыке целиком попала хотя бы в одну из них.
 */
export const HALF_OVERLAP = 0.08;

export async function pageHalves(page: PhotoPage): Promise<[PhotoPage, PhotoPage]> {
  // .rotate() без угла — по EXIF; размеры берём уже после поворота.
  const turned = await sharp(page.photo).rotate().toBuffer({ resolveWithObject: true });
  const w = turned.info.width;
  const h = turned.info.height;
  const cut = Math.round(h * (0.5 + HALF_OVERLAP / 2));
  const start = Math.round(h * (0.5 - HALF_OVERLAP / 2));
  const crop = (top: number, cropHeight: number) =>
    sharp(turned.data).extract({ left: 0, top, width: w, height: cropHeight }).jpeg({ quality: 90 }).toBuffer();
  const [upper, lower] = await Promise.all([crop(0, cut), crop(start, h - start)]);
  return [
    { photo: upper, mimeType: "image/jpeg" },
    { photo: lower, mimeType: "image/jpeg" },
  ];
}
