/**
 * CSP violation report receiver — Wave 10 / W10-P2 / S1.
 *
 * The browser POSTs a structured violation report here whenever a
 * resource load violates the CSP set by `next.config.ts`. We log the
 * report to the server console (Cloud Run captures it) and forward to
 * Sentry as a breadcrumb-style event so we can triage the
 * Report-Only ramp before promoting CSP to enforced.
 *
 * Fail-OPEN by design: we always return 204, even on a malformed
 * report. The browser doesn't retry CSP reports and we don't want a
 * receiver bug to surface as a console error in the user's browser.
 *
 * The endpoint is publicly reachable (CSP report-uri is unauthenticated
 * by spec). We don't add a body-size limit hook here — Next.js
 * route-handlers cap at 1 MB by default, plenty for a CSP report.
 */

import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const text = await req.text();
    const parsed = (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { raw: text } as Record<string, unknown>;
      }
    })();
    const report =
      (parsed["csp-report"] as Record<string, unknown> | undefined) ??
      (parsed as Record<string, unknown>);

    // Cloud Run logs surface this for grep'able alerting.
    console.warn("[csp-report]", {
      blockedUri: report["blocked-uri"] ?? report["blockedURI"],
      violatedDirective: report["violated-directive"] ?? report["effectiveDirective"],
      documentUri: report["document-uri"] ?? report["documentURL"],
      sourceFile: report["source-file"] ?? report["sourceFile"],
    });

    Sentry.captureMessage("csp_violation", {
      level: "warning",
      tags: {
        directive: String(report["violated-directive"] ?? report["effectiveDirective"] ?? ""),
        app: "web-backoffice",
      },
      extra: report,
    });
  } catch {
    // Receiver swallows everything — see file header.
  }
  return new Response(null, { status: 204 });
}
