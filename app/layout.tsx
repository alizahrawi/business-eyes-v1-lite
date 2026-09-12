import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "روزنگار | گزارش کار روزانه",
  description: "تبدیل فعالیت‌های روزانه فارسی به گزارش کاری کوتاه و استاندارد",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f4f7ff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fa" dir="rtl"><body className="antialiased"><Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />{children}</body></html>;
}
