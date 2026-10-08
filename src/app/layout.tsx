import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { NavFeedback } from "@/components/nav-feedback";
import { InstallCapture } from "@/components/install-app";
import { BRAND_GREEN, OPEN_GRAPH_BASE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
// Индексацию по умолчанию не даём: кабинет и страницы клиентов с долгами не для
// поиска. Открыта только витрина — она разрешает сама (src/app/login/page.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Depter · Учёт долгов магазина",
  description: "Долги клиентов, расчёты с поставщиками и накладные вашего магазина",
  applicationName: SITE_NAME,
  robots: { index: false, follow: false },
  openGraph: {
    ...OPEN_GRAPH_BASE,
    title: "Depter · Учёт долгов магазина",
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
  // Открытый с экрана «Домой» на iPhone — как приложение, без адресной строки.
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
};
// Цвет полоски браузера и окна установленного приложения.
export const viewport: Viewport = { themeColor: BRAND_GREEN };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <Suspense fallback={null}>
          <NavFeedback />
        </Suspense>
        <InstallCapture />
        {children}
      </body>
    </html>
  );
}
