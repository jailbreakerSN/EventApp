import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyStateEditorial } from "@teranga/shared-ui";
import { RetryButton } from "./retry-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offlinePage");
  return { title: t("title") };
}

export default async function OfflinePage() {
  const t = await getTranslations("offlinePage");
  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full">
        <EmptyStateEditorial
          icon={WifiOff}
          kicker="— HORS LIGNE"
          title={t("heading")}
          description={t("hint")}
          action={<RetryButton />}
        />
      </div>
    </div>
  );
}
