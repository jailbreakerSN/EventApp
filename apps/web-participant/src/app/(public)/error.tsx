"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.errorBoundary");

  useEffect(() => {
    console.error("[PublicError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker={t("kicker")}
          title={t("title")}
          description={error.message || t("description")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={reset}>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("retry")}
              </Button>
              <Link href="/events">
                <Button variant="outline">{t("home")}</Button>
              </Link>
            </div>
          }
        />
      </div>
    </div>
  );
}
