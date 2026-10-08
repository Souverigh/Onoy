import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Фавикон и значок приложения: та же «D», что в кружке на странице клиента.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default async function Icon() {
  const bold = await readFile(join(process.cwd(), "public/fonts/PTSans-Bold.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          background: "#245d4c",
          color: "#dcf2a5",
          fontSize: 340,
          fontWeight: 700,
          fontFamily: "PT Sans",
        }}
      >
        D
      </div>
    ),
    { ...size, fonts: [{ name: "PT Sans", data: bold, weight: 700, style: "normal" }] },
  );
}
