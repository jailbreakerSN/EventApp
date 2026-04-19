import Link from "next/link";
import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default async function NotFound() {
  const t = await getTranslations("common.notFoundPage");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <p
          aria-hidden="true"
          className="font-serif-display text-[96px] font-semibold leading-none tracking-[-0.04em] text-teranga-navy/85 dark:text-teranga-gold"
        >
          404
        </p>
        <EmptyStateEditorial
          className="mt-4"
          icon={SearchX}
          kicker={t("kicker")}
          title={t("title")}
          description={t("description")}
          action={
            <Link href="/events">
              <Button>{t("cta")}</Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}
