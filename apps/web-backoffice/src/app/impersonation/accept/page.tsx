"use client";

/**
 * OAuth-style impersonation accept landing — backoffice target side.
 *
 * The admin tab opened this URL in a new tab with a `?code=…` param.
 * The page is intentionally minimal:
 *
 *   1. Read the code from the URL.
 *   2. POST to `/v1/impersonation/exchange` (no auth — this origin
 *      has no Firebase session yet).
 *   3. `signInWithCustomToken` with the returned token — this stamps
 *      the `impersonatedBy` / `impersonationExpiresAt` claims onto
 *      the new ID token on THIS origin's Firebase Auth instance.
 *   4. Strip the code from the URL via `history.replaceState` so a
 *      reload or "Copy page URL" doesn't leak the (now-consumed)
 *      code into history, breadcrumbs, or clipboard.
 *   5. Route the admin to the role-appropriate backoffice home.
 *
 * Errors are surfaced as a single-card failure page with a manual
 * "Retour au back-office" link — we never auto-redirect on error
 * because the operator needs to know the session did not open.
 *
 * See `packages/shared-types/src/impersonation.types.ts` for the full
 * security rationale of the flow.
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { api } from "@/lib/api-client";
import type { ImpersonationExchangeResponse } from "@teranga/shared-types";

type Status =
  | { kind: "loading" }
  | { kind: "success"; targetLabel: string }
  | { kind: "error"; code: string; message: string };

function AcceptInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const code = search.get("code");
      if (!code) {
        setStatus({
          kind: "error",
          code: "MISSING_CODE",
          message: "Lien d'impersonation invalide (code manquant).",
        });
        return;
      }
      try {
        const res = await api.post<{ success: true; data: ImpersonationExchangeResponse }>(
          "/v1/impersonation/exchange",
          { code },
          false,
        );
        if (cancelled) return;

        // Strip the consumed code from the URL BEFORE the async
        // signInWithCustomToken call (security review, LOW finding):
        // that await can take 200–400 ms, during which browser
        // extensions or analytics can read `window.location.href`.
        // The code is already server-marked-consumed, so a read
        // here is exploitation-free, but removing it first honours
        // the design principle of "code leaves the URL ASAP".
        if (typeof window !== "undefined") {
          const clean = new URL(window.location.href);
          clean.searchParams.delete("code");
          window.history.replaceState({}, "", clean.toString());
        }

        // Exchange the server-minted custom token on THIS origin's
        // Firebase Auth instance. The resulting ID token carries the
        // `impersonatedBy` claim which the banner + middleware read.
        await signInWithCustomToken(firebaseAuth, res.data.customToken);

        const label = res.data.targetDisplayName ?? res.data.targetEmail ?? res.data.targetUid;
        setStatus({ kind: "success", targetLabel: label });

        // Small delay so the user sees the confirmation before being
        // redirected. The dashboard layout's own role gate handles the
        // final landing (super_admin → /admin/inbox, organizer →
        // /dashboard, venue_manager → /venues). PR B tightens this
        // into a deterministic resolveHomeUrl helper.
        setTimeout(() => {
          if (!cancelled) router.replace("/dashboard");
        }, 500);
      } catch (err: unknown) {
        if (cancelled) return;
        const code = (err as { code?: string }).code ?? "IMPERSONATION_FAILED";
        const message =
          (err as { message?: string }).message ?? "Échec de la session d'impersonation.";
        setStatus({ kind: "error", code, message });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps: the exchange is single-use, and the
    // captured `router` / `search` / `api` references are stable. Re-
    // running would hit the CONSUMED branch and surface an error
    // banner to the user.
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        {status.kind === "loading" && (
          <>
            <h1 className="text-lg font-semibold text-foreground">
              Ouverture de la session d&apos;impersonation…
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Validation du code côté serveur et ouverture de la session sur cet onglet.
            </p>
          </>
        )}
        {status.kind === "success" && (
          <>
            <h1 className="text-lg font-semibold text-foreground">Session ouverte</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Vous êtes connecté·e en tant que <strong>{status.targetLabel}</strong>. Redirection…
            </p>
          </>
        )}
        {status.kind === "error" && (
          <>
            <h1 className="text-lg font-semibold text-destructive">Session non ouverte</h1>
            <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">code : {status.code}</p>
            <button
              type="button"
              className="mt-4 inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              onClick={() => {
                if (typeof window !== "undefined") window.close();
              }}
            >
              Fermer l&apos;onglet
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// `useSearchParams` requires a Suspense boundary at the route level
// per Next.js 14 App Router rules. Fallback matches the loading state
// so the first paint is consistent.
export default function ImpersonationAcceptPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AcceptInner />
    </Suspense>
  );
}
