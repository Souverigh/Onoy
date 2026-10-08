import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// iPhone сам скругляет углы — фон на весь квадрат.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
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
          background: "#245d4c",
          color: "#dcf2a5",
          fontSize: 120,
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
