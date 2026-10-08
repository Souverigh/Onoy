import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Превью ссылки на depter.kg в WhatsApp, Telegram и соцсетях. Собирается при сборке.
export const alt = "Depter - учёт долгов магазина онлайн";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const [regular, bold] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/PTSans-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/PTSans-Bold.ttf")),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#245d4c",
          color: "#f6f7f4",
          fontFamily: "PT Sans",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 88,
              height: 88,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              background: "#dcf2a5",
              color: "#245d4c",
              fontSize: 60,
              fontWeight: 700,
            }}
          >
            D
          </div>
          <span style={{ fontSize: 56, fontWeight: 700 }}>Depter</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, color: "#dcf2a5" }}>
            Порядок в долгах. Свободная голова.
          </span>
          <span style={{ fontSize: 36, lineHeight: 1.35 }}>
            Тетрадь долгов магазина - онлайн. Клиенты, поставщики, накладные в WhatsApp.
          </span>
        </div>
        <span style={{ fontSize: 30, opacity: 0.8 }}>depter.kg</span>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "PT Sans", data: regular, weight: 400, style: "normal" },
        { name: "PT Sans", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
