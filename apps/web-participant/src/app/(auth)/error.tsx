"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.errorBoundary");

  useEffect(() => {
    console.error("[AuthError]", error);
  }, [error]);

  return (
    <div className="w-full">
      <EmptyStateEditorial
        icon={AlertTriangle}
        kicker={t("authKicker")}
        title={t("authTitle")}
        description={error.message || t("authDescription")}
        action={
          <Button onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("retry")}
          </Button>
        }
      />
    </div>
  );
}
