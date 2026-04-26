/**
 * CSP violation report receiver — Wave 10 / W10-P2 / S1.
 * See `apps/web-backoffice/src/app/api/csp-report/route.ts` for the
 * full rationale. The participant variant tags reports with
 * `app: "web-participant"` so the Sentry filter can split signal
 * between the two web surfaces.
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
        app: "web-participant",
      },
      extra: report,
    });
  } catch {
    // Receiver swallows everything — see backoffice file header.
  }
  return new Response(null, { status: 204 });
}
