import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster, OfflineBanner } from "@teranga/shared-ui";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  // Limit preloaded weights to keep initial payload small on African 3G networks.
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Teranga", template: "%s | Teranga" },
  description: "L'Événementiel Africain, Connecté et Mémorable",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  themeColor: "#1A1A2E",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // i18n: the cookie-driven locale comes from src/i18n/request.ts; the
  // provider hydrates messages for all client components below.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <OfflineBanner />
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
