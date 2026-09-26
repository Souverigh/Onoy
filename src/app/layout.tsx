import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Depter · Учёт долгов магазина",
  description: "Долги клиентов, расчёты с поставщиками и накладные вашего магазина",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
