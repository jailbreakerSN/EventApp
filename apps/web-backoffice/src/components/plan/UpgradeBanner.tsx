"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

interface UpgradeBannerProps {
  feature: string;
  message?: string;
  compact?: boolean;
}

export function UpgradeBanner({ feature, message, compact = false }: UpgradeBannerProps) {
  const defaultMessage = `Passez à un plan supérieur pour accéder à ${feature}.`;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p className="text-xs text-amber-700 dark:text-amber-400">{message ?? defaultMessage}</p>
        <Link
          href="/organization/billing"
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Upgrade
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6">
      <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
        Fonctionnalité premium
      </h3>
      <p className="text-sm text-amber-700 dark:text-amber-400 mb-4">{message ?? defaultMessage}</p>
      <Link
        href="/organization/billing"
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
      >
        Voir les plans
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
