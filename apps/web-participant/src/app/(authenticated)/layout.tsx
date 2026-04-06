import { Header } from "@/components/layouts/header";
import { Footer } from "@/components/layouts/footer";
import { AuthGuard } from "@/components/auth-guard";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <AuthGuard>{children}</AuthGuard>
      </main>
      <Footer />
    </div>
  );
}
