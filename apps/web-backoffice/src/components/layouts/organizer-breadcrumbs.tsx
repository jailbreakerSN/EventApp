"use client";

/**
 * Organizer overhaul — Phase O1.
 *
 * Auto-derived breadcrumb panel mounted by `(dashboard)/layout.tsx`
 * above the `<main>` content. Reads from `useOrganizerBreadcrumbs()`,
 * which itself derives the trail from the pathname + nav taxonomy +
 * (when relevant) the current event title.
 *
 * Rendering uses the canonical shared-ui `Breadcrumb` primitives so
 * the visual identity matches every other Teranga surface (admin
 * shell, participant app).
 *
 * The component is invisible on landing pages (`/dashboard`, `/inbox`,
 * `/`) — the hook returns `shouldRender: false` for those paths so the
 * layout doesn't reserve vertical space.
 */

import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { useOrganizerBreadcrumbs } from "@/hooks/use-organizer-breadcrumbs";

export function OrganizerBreadcrumbs() {
  const { items, shouldRender } = useOrganizerBreadcrumbs();
  if (!shouldRender || items.length === 0) return null;

  return (
    <div className="border-b border-border bg-background px-4 sm:px-6 py-2">
      <Breadcrumb>
        <BreadcrumbList>
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            return (
              <BreadcrumbItem key={`${item.label}-${idx}`}>
                {isLast || !item.href ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <>
                    <BreadcrumbLink asChild>
                      <Link href={item.href}>{item.label}</Link>
                    </BreadcrumbLink>
                    <BreadcrumbSeparator />
                  </>
                )}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
