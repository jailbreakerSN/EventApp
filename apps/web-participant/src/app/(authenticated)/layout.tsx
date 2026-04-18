import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layouts/header";
import { Footer } from "@/components/layouts/footer";
import { AuthGuard } from "@/components/auth-guard";
import { EmailVerificationBanner } from "@/components/email-verification-banner";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const tNav = await getTranslations("nav");
  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip to content link — WCAG 2.4.1 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        {tNav("skipToContent")}
      </a>
      <Header />
      <EmailVerificationBanner />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        <AuthGuard>{children}</AuthGuard>
      </main>
      <Footer />
    </div>
  );
}
