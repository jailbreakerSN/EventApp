import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";
import { Toaster } from "@teranga/shared-ui";
import { OfflineIndicator } from "@/components/offline-indicator";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  // Limit preloaded weights to keep initial payload small on African 3G networks.
  weight: ["400", "500", "600", "700"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["500", "600"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Teranga — Découvrez les événements au Sénégal",
    template: "%s | Teranga",
  },
  description:
    "Plateforme de gestion d'événements au Sénégal et en Afrique de l'Ouest. Découvrez, inscrivez-vous et participez aux meilleurs événements.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"),
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
  openGraph: {
    type: "website",
    locale: "fr_SN",
    siteName: "Teranga",
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "Teranga Event" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // i18n: the cookie-driven locale comes from src/i18n/request.ts; the
  // provider hydrates messages for all client components below.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body className={inter.className}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <OfflineIndicator />
          <Providers>{children}</Providers>
          <Toaster />
          <PwaInstallBanner />
          <SwRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
