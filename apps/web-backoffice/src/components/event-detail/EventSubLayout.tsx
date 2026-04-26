"use client";

/**
 * Organizer overhaul — Phase O4.
 *
 * Reusable sub-section navigation shell for the event-detail
 * hierarchy. Each top-level section ("configuration", "audience",
 * "operations") renders this with its own sub-nav config; the layout
 * provides:
 *   - a horizontal sub-tab strip (or vertical sub-sidebar at lg+)
 *   - the children content panel
 *   - sticky positioning on the sub-nav so deep scroll keeps the
 *     navigation visible.
 *
 * Mobile contract:
 *   - The sub-tab strip becomes horizontally scrollable so a section
 *     with > 4 sub-pages stays usable on a 360 px screen.
 *   - On lg+ the strip stays at the top of the children area (not a
 *     left rail) — the rail pattern fights the parent dashboard
 *     sidebar for horizontal real estate.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface EventSubNavItem {
  /** Stable identifier — also used as React key. */
  id: string;
  /** Absolute href. */
  href: string;
  /** French label rendered in the strip. */
  label: string;
  /** Optional Lucide icon shown left of the label. */
  icon?: ComponentType<{ className?: string }>;
  /**
   * Plan-feature gate hint — purely cosmetic (renders a lock badge
   * next to the label). The real gating happens at the page level
   * via `<PlanGate>`.
   */
  planLocked?: boolean;
}

export interface EventSubLayoutProps {
  /** French label of the parent section (e.g. "Configuration"). */
  sectionLabel: string;
  items: readonly EventSubNavItem[];
  children: React.ReactNode;
}

export function EventSubLayout({ sectionLabel, items, children }: EventSubLayoutProps) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      {/* Sub-section label + tab strip — sticky so a long form keeps
          the nav reachable while the user scrolls. */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 bg-background border-b border-border px-4 sm:px-6">
        <div className="pb-1 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {sectionLabel}
          </p>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto scrollbar-none"
          aria-label={`Sous-navigation ${sectionLabel}`}
        >
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 motion-safe:transition-colors whitespace-nowrap",
                  active
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                {item.label}
                {item.planLocked && (
                  <span
                    className="ml-1 text-[9px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground"
                    aria-label="Fonctionnalité gated par le plan"
                  >
                    Pro
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Children panel */}
      <div>{children}</div>
    </div>
  );
}
