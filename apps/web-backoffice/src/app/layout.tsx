import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <OfflineBanner />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
