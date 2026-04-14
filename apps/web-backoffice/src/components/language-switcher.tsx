"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LanguageSwitcher as SharedLanguageSwitcher } from "@teranga/shared-ui";

/**
 * Next.js wrapper around the framework-agnostic <LanguageSwitcher>
 * primitive from shared-ui. Wires the cookie change to router.refresh()
 * so next-intl picks up the new messages on the next server render.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const locale = useLocale();

  return (
    <SharedLanguageSwitcher
      locale={locale}
      onChange={() => router.refresh()}
      className={className}
    />
  );
}
