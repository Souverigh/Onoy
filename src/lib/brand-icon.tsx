import { ImageResponse } from "next/og";
import { BRAND_ACCENT, BRAND_GREEN } from "./site";

export type LogoShape = "rounded" | "round" | "square" | "maskable";

/** «D» из фигур (без шрифта) в квадрате 512×512: прямая спина и полукруг, толщина 64. */
const D_PATH = "M136 112H248A144 144 0 0 1 248 400H136Z M200 176V336H248A80 80 0 0 0 248 176Z";

/**
 * Логотип Depter — светлая «D» на фирменном зелёном. Тот же файл лежит в
 * public/logo.svg. rounded — скруглённый квадрат (сам логотип), round — круг
 * (фавикон), square — во весь квадрат (iPhone сам скругляет углы), maskable —
 * буква мельче: Android может обрезать значок до круга в 80% размера.
 * inverted — тёмная «D» на светлом, для зелёного фона (превью ссылки).
 */
export function logoSvg(shape: LogoShape, inverted = false) {
  const [back, front] = inverted ? [BRAND_ACCENT, BRAND_GREEN] : [BRAND_GREEN, BRAND_ACCENT];
  const bg =
    shape === "round"
      ? `<circle cx="256" cy="256" r="256" fill="${back}"/>`
      : `<rect width="512" height="512" rx="${shape === "rounded" ? 112 : 0}" fill="${back}"/>`;
  const scale = shape === "maskable" ? 0.72 : 1;
  const d = `<path fill="${front}" fill-rule="evenodd" d="${D_PATH}" transform="translate(${256 * (1 - scale)} ${256 * (1 - scale)}) scale(${scale})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${d}</svg>`;
}

export const logoDataUrl = (shape: LogoShape, inverted = false) =>
  `data:image/svg+xml;base64,${Buffer.from(logoSvg(shape, inverted)).toString("base64")}`;

/** PNG-значок нужного размера (фавикон, iPhone, Android). */
export function brandIcon(size: number, shape: LogoShape) {
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoDataUrl(shape)} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
