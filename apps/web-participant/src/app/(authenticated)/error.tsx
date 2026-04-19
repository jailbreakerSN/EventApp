"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function AuthenticatedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.errorBoundary");

  useEffect(() => {
    console.error("[AuthenticatedError]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center p-12">
      <div className="w-full max-w-md">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker={t("kicker")}
          title={t("unexpectedTitle")}
          description={error.message || t("unexpectedDescription")}
          action={
            <Button onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("retry")}
            </Button>
          }
        />
      </div>
    </div>
  );
}
