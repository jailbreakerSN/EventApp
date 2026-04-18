import * as React from "react";
import { EditorialHero } from "@teranga/shared-ui";
import { ThemeLogo } from "@/components/theme-logo";

export interface AuthShellProps {
  /** Fraunces serif title rendered in the hero column. */
  heroTitle: React.ReactNode;
  /** Short lead paragraph under the title. */
  heroLead?: string;
  /** Optional mono kicker above the title. Defaults to the organiser badge. */
  heroKicker?: string;
  /**
   * Form card content — the right pane. Parent owns the card chrome so we
   * can vary padding / headers per page (login vs. success states).
   */
  children: React.ReactNode;
}

/**
 * Editorial auth shell shared by /login, /forgot-password, and /verify-email.
 *
 * Layout:
 * - >= 1024px: 2-column grid — narrow navy `EditorialHero` on the left,
 *   form card on the right.
 * - < 1024px: single column — brand mark on a navy strip above the form.
 *
 * The navy pane re-uses the editorial hero primitive from `@teranga/shared-ui`
 * so the auth surface feels on-brand with the participant app. No new
 * auth-only primitives are introduced — the brand mark is inlined because
 * it's a one-off composition that shouldn't pollute shared-ui.
 */
export function AuthShell({
  heroTitle,
  heroLead,
  heroKicker = "✦ Teranga Events · Organisateur",
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-muted/40 dark:bg-background lg:grid lg:grid-cols-[minmax(380px,_5fr)_7fr]">
      {/* Hero column — navy editorial panel */}
      <div className="relative flex min-h-[280px] flex-col lg:min-h-screen">
        <EditorialHero
          variant="navy"
          kicker={heroKicker}
          title={heroTitle}
          lead={heroLead}
          className="min-h-[280px] flex-1 sm:min-h-[320px] lg:min-h-full lg:h-full"
        />
        {/* Brand mark pinned top-left of the navy pane — sits above the
            hero texture so it is legible regardless of copy length. */}
        <div className="pointer-events-none absolute left-6 top-6 z-20 flex items-center gap-3 lg:left-8 lg:top-8">
          <div className="rounded-full bg-white/95 px-3 py-1.5 shadow-sm">
            <ThemeLogo
              width={120}
              height={72}
              className="h-8 w-auto"
              priority
            />
          </div>
        </div>
      </div>

      {/* Form column */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
