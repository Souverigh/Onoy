import "server-only";
import { Font } from "@react-pdf/renderer";

let registeredFor = "";

/**
 * PT Sans поддерживает кириллицу — встроенные шрифты react-pdf (Helvetica и
 * т.д.) не поддерживают. Файлы лежат в `public/fonts` и раздаются Next.js как
 * статика; регистрируем по HTTP-URL (react-pdf сам это умеет), а не через
 * fs.readFileSync — в serverless-функции Vercel `public/` не гарантированно
 * попадает в файловую систему функции.
 */
export function ensureFontsRegistered(origin: string) {
  if (registeredFor === origin) return;
  Font.register({
    family: "PT Sans",
    fonts: [
      { src: `${origin}/fonts/PTSans-Regular.ttf`, fontWeight: "normal" },
      { src: `${origin}/fonts/PTSans-Bold.ttf`, fontWeight: "bold" },
    ],
  });
  registeredFor = origin;
}
