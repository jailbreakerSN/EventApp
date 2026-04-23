"use client";

/**
 * Phase 3 — Shared detail-page scaffold for admin entities.
 *
 * Every admin detail page (organization, user, venue, event, plan) shares
 * the same high-level layout:
 *
 *   [breadcrumb]
 *   [header: name + status pills + quick actions]
 *   [tabs: Overview · Members · Events · Audit · …]
 *   [active tab content]
 *
 * Rather than re-implementing the scaffold 5× and drifting, this component
 * centralises the layout + tab URL-state so each detail page becomes a
 * thin wrapper that passes { title, subtitle, tabs, quickActions } and
 * renders the selected tab content.
 *
 * URL state: the selected tab is stored in `?tab=<id>` — reloads survive,
 * links can be shared ("look at the Members tab of this org"), and
 * analytics can track which tab admins pick most.
 */

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { cn } from "@/lib/utils";

export type EntityTab = {
  id: string;
  label: string;
  /** Optional count rendered as a pill next to the label (e.g. members count). */
  count?: number;
  /** The tab's panel content. Lazy-evaluated via render function. */
  render: () => ReactNode;
};

export type EntityQuickAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Visual variant — influences color only. */
  variant?: "default" | "destructive";
  onClick?: () => void;
  /** Disabled reason shown on hover — tooltip-style. */
  disabledReason?: string;
};

export type EntityBreadcrumb = {
  label: string;
  href?: string;
};

interface EntityDetailLayoutProps {
  breadcrumbs: EntityBreadcrumb[];
  title: string;
  subtitle?: ReactNode;
  /** Pills rendered next to the title (status, verification, plan, etc). */
  pills?: ReactNode;
  quickActions?: EntityQuickAction[];
  tabs: EntityTab[];
  /** Optional default tab id when no ?tab= param is present. */
  defaultTabId?: string;
}

export function EntityDetailLayout({
  breadcrumbs,
  title,
  subtitle,
  pills,
  quickActions,
  tabs,
  defaultTabId,
}: EntityDetailLayoutProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTabId = searchParams?.get("tab") ?? defaultTabId ?? tabs[0]?.id ?? "";
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const setTab = (id: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={`${crumb.label}-${idx}`} className="flex items-center">
                <BreadcrumbItem>
                  {isLast || !crumb.href ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </div>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      {/* Entity header — title, status pills, quick actions */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {pills && <div className="flex flex-wrap items-center gap-1.5">{pills}</div>}
          </div>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
        </div>

        {quickActions && quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                disabled={Boolean(action.disabledReason)}
                title={action.disabledReason}
                aria-label={action.label}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  action.variant === "destructive"
                    ? "border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                    : "border-border text-foreground hover:bg-muted disabled:opacity-50",
                  "disabled:pointer-events-none",
                )}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role */}
        <nav className="-mb-px flex flex-wrap gap-4" role="tablist" aria-label="Onglets détail">
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`tab-panel-${tab.id}`}
                onClick={() => setTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
                  active
                    ? "border-teranga-gold text-teranga-gold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {typeof tab.count === "number" && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      active
                        ? "bg-teranga-gold/10 text-teranga-gold"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active tab panel */}
      <div
        role="tabpanel"
        id={`tab-panel-${activeTab?.id}`}
        aria-labelledby={activeTab?.id}
        className="min-h-[24rem]"
      >
        {activeTab?.render()}
      </div>
    </div>
  );
}
