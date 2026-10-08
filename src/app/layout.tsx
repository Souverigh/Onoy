import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { NavFeedback } from "@/components/nav-feedback";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
// Индексацию по умолчанию не даём: кабинет и страницы клиентов с долгами не для
// поиска. Открыта только витрина — она разрешает сама (src/app/login/page.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Depter · Учёт долгов магазина",
  description: "Долги клиентов, расчёты с поставщиками и накладные вашего магазина",
  applicationName: SITE_NAME,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ru_RU",
    title: "Depter · Учёт долгов магазина",
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
};
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
        {children}
      </body>
    </html>
  );
}
