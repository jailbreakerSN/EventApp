import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Toaster } from "@teranga/shared-ui";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Teranga — Découvrez les événements au Sénégal",
    template: "%s | Teranga",
  },
  description:
    "Plateforme de gestion d'événements au Sénégal et en Afrique de l'Ouest. Découvrez, inscrivez-vous et participez aux meilleurs événements.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"),
  openGraph: {
    type: "website",
    locale: "fr_SN",
    siteName: "Teranga",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
