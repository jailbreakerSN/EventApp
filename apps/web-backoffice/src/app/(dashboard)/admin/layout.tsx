"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { BrandedLoader } from "@/components/branded-loader";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, hasRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !hasRole("super_admin")) {
      router.replace("/unauthorized");
    }
  }, [user, loading, hasRole, router]);

  if (loading) return <BrandedLoader label="Chargement de l'administration..." />;
  if (!user || !hasRole("super_admin")) return null;
  return <>{children}</>;
}
