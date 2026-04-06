"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Spinner } from "@teranga/shared-ui";

const REDIRECT_KEY = "teranga_redirect_after_login";

export function saveRedirectUrl() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(REDIRECT_KEY, window.location.pathname + window.location.search);
  }
}

export function getAndClearRedirectUrl(): string | null {
  if (typeof window === "undefined") return null;
  const url = sessionStorage.getItem(REDIRECT_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);
  return url;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      saveRedirectUrl();
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
