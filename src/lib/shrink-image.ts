/**
 * Фото с телефона весит 2–8 МБ, а тело запроса server action ограничено
 * (next.config.ts, serverActions.bodySizeLimit). Gemini всё равно читает
 * документ в среднем разрешении, поэтому ужимаем фото в браузере до
 * MAX_SIDE по длинной стороне: загрузка и распознавание быстрее, качество
 * распознавания накладной то же. Если браузер не умеет декодировать формат
 * (например, HEIC) — отдаём исходный файл, сервер его примет как раньше.
 */
const MAX_SIDE = 2000;
const QUALITY = 0.85;
const SMALL_ENOUGH = 700 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SMALL_ENOUGH) return file;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

/**
 * Подменяет файл в самом <input type="file">, чтобы при отправке формы ушла
 * уже ужатая версия — и хеш совпал с тем, что загружали при проверке фото.
 */
export async function shrinkInputFile(input: HTMLInputElement): Promise<File | null> {
  const original = input.files?.[0];
  if (!original) return null;
  const shrunk = await shrinkImage(original);
  if (shrunk !== original) {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(shrunk);
      input.files = transfer.files;
    } catch {
      // Старый браузер без DataTransfer — отправится исходный файл.
    }
  }
  return shrunk;
}
