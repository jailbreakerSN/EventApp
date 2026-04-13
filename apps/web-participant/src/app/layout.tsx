import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Toaster } from "@teranga/shared-ui";
import { OfflineIndicator } from "@/components/offline-indicator";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  // Limit preloaded weights to keep initial payload small on African 3G networks.
  weight: ["400", "500", "600", "700"],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <OfflineIndicator />
        <Providers>{children}</Providers>
        <Toaster />
        <SwRegister />
      </body>
    </html>
  );
}
