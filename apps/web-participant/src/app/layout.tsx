import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";
import { Toaster } from "@teranga/shared-ui";
import { OfflineIndicator } from "@/components/offline-indicator";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SwRegister } from "@/components/sw-register";
import { CookieConsentBanner } from "@/components/cookie-consent";
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
  // Phase D.5: switch to `.webmanifest` (recommended MIME-typed extension)
  // to unlock iOS 16.4+ Web Push via "Add to Home Screen". The file points
  // at `/icons/*` assets; the legacy /manifest.json stays on disk as a
  // fallback for already-installed PWAs that cached the old URL.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Teranga Events",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // When /icons/apple-touch-icon.png ships (see apps/web-participant/public/icons/README.md)
    // iOS will prefer it over the legacy /apple-icon.png via the purpose-any match.
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
  openGraph: {
    type: "website",
    locale: "fr_SN",
    siteName: "Teranga",
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "Teranga Event" }],
  },
};

// Viewport lives in its own export in the Next 15 App Router. Theme color
// matches the PWA manifest `theme_color` so the iOS status bar / Android
// chrome bar tint is consistent whether the app is opened in a browser tab
// or from the home-screen PWA icon.
export const viewport: Viewport = {
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
          <OfflineIndicator />
          {/*
            Impersonation banner MUST live at the root layout (above the
            route-group layouts) so it's visible on every page — the
            participant home resolves in (public), the authenticated
            shell in (authenticated), and the impersonation accept page
            is at app/impersonation/. Mounting inside any one group
            would miss the others. The banner self-gates: it only
            renders when the current Firebase ID token carries the
            server-signed `impersonatedBy` claim, so mounting
            unconditionally is safe (no flash for non-impersonated
            sessions).
          */}
          <ImpersonationBanner />
          <Providers>{children}</Providers>
          <Toaster />
          <SwRegister />
          {/* W10-P6 / L4 — cookie consent banner (Senegal Loi 2008-12 +
              GDPR). Self-gates on `localStorage.teranga_cookie_consent_v1`;
              renders nothing once the user has chosen. The Sentry
              client init re-checks consent before activating analytics
              + replay (currently inert; future-proofed). */}
          <CookieConsentBanner />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
