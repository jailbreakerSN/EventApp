import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster, OfflineBanner } from "@teranga/shared-ui";

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
  title: { default: "Teranga", template: "%s | Teranga" },
  description: "L'Événementiel Africain, Connecté et Mémorable",
  // Phase D.5: switch to `.webmanifest` for iOS 16.4+ Web Push PWA support.
  // The legacy /manifest.json stays on disk for already-installed clients.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Teranga Admin",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // When /icons/apple-touch-icon.png ships (see apps/web-backoffice/public/icons/README.md)
    // iOS will prefer it over the legacy /apple-icon.png via the purpose-any match.
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  // Aligned with manifest.webmanifest theme_color for a consistent status-bar
  // tint across browser + PWA launches.
  themeColor: "#0a2540",
  width: "device-width",
  initialScale: 1,
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
          <OfflineBanner />
          <Providers>{children}</Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
