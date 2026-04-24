"use client";

/**
 * OAuth-style impersonation accept landing — participant-app target side.
 *
 * Mirror of the backoffice accept page. The admin's browser opened this
 * URL in a new tab with `?code=…`. We:
 *
 *   1. POST the code to `/v1/impersonation/exchange` (no bearer —
 *      this origin has no Firebase session yet).
 *   2. `signInWithCustomToken` with the returned token to land the
 *      impersonated session on THIS origin's Firebase instance.
 *   3. Strip the code from the URL (`history.replaceState`) — the
 *      code is single-use but removing it defends against reload /
 *      copy-URL leaking the consumed value into history.
 *   4. Redirect to the participant home.
 *
 * The participant (authenticated) layout mounts `<ImpersonationBanner>`
 * which detects the session from the token's claims and renders the
 * amber "Quitter" bar.
 *
 * See `packages/shared-types/src/impersonation.types.ts` for the full
 * security rationale.
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
        // the token-exchange await can take 200–400 ms, during which
        // any script on the page can still read the code from
        // window.location. Server-marked-consumed already, but we
        // honour the "code leaves URL ASAP" design principle.
        if (typeof window !== "undefined") {
          const clean = new URL(window.location.href);
          clean.searchParams.delete("code");
          window.history.replaceState({}, "", clean.toString());
        }

        await signInWithCustomToken(firebaseAuth, res.data.customToken);

        const label = res.data.targetDisplayName ?? res.data.targetEmail ?? res.data.targetUid;
        setStatus({ kind: "success", targetLabel: label });
        setTimeout(() => {
          if (!cancelled) router.replace("/");
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
    // Intentionally empty deps — the exchange is single-use and a
    // re-run would fail with CONSUMED (409). The captured `router` /
    // `search` / `api` references are stable.
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
              Validation du code et ouverture de la session participant.
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

export default function ImpersonationAcceptPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AcceptInner />
    </Suspense>
  );
}
