"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * Speaker portal landing page. Reached via a magic link (no login).
 * Verifies the token with the API, then surfaces a minimal "edit
 * your bio" surface scoped to the speaker resource the token grants.
 *
 * Three states:
 *   1. **Verifying** — spinner while we hit `/v1/magic-links/verify`.
 *   2. **Invalid / expired** — friendly explanation + "Demander un
 *      nouveau lien à l'organisateur" copy.
 *   3. **Authenticated portal** — readable speaker resource id +
 *      pointer to the bio editor (the editor itself stays in the
 *      backoffice's existing speaker form, gated to magic-link
 *      tokens via the verify response — out of scope of O10's
 *      delivery; we ship the landing surface).
 *
 * The page intentionally lives OUTSIDE the `(dashboard)` route group
 * so the layout doesn't try to mount the auth provider / sidebar.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@teranga/shared-ui";
import { KeyRound, AlertTriangle, Mic } from "lucide-react";
import { useVerifyMagicLink } from "@/hooks/use-magic-links";

export default function SpeakerPortalPage() {
  return (
    <Suspense
      fallback={
        <PortalShell>
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </PortalShell>
      }
    >
      <SpeakerPortalContent />
    </Suspense>
  );
}

function SpeakerPortalContent() {
  const params = useSearchParams();
  const token = params.get("token");
  const verify = useVerifyMagicLink(token);

  if (!token) {
    return (
      <PortalShell>
        <ErrorBlock
          title="Lien manquant"
          description="Le lien que vous avez ouvert ne contient pas de jeton d'accès. Demandez un nouveau lien à l'organisateur."
        />
      </PortalShell>
    );
  }

  if (verify.isLoading) {
    return (
      <PortalShell>
        <p className="text-sm text-muted-foreground">Vérification du lien…</p>
      </PortalShell>
    );
  }

  if (verify.isError || !verify.data) {
    const message =
      verify.error instanceof Error ? verify.error.message : "Lien invalide ou expiré.";
    return (
      <PortalShell>
        <ErrorBlock title="Lien invalide ou expiré" description={message} />
      </PortalShell>
    );
  }

  const { role, resourceId, eventId, recipientEmail, expiresAt } = verify.data;
  if (role !== "speaker") {
    return (
      <PortalShell>
        <ErrorBlock
          title="Mauvais portail"
          description="Ce lien est destiné à un autre type d'utilisateur. Demandez le bon lien à l'organisateur."
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teranga-gold/15 text-teranga-gold-dark">
              <Mic className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Bienvenue sur votre portail</h2>
              <p className="text-xs text-muted-foreground">
                Connecté en tant que <span className="font-medium">{recipientEmail}</span>
              </p>
            </div>
          </div>
          <div className="rounded-md bg-muted/40 p-4 text-sm space-y-1.5">
            <p>
              <span className="font-medium">Identifiant intervenant :</span> {resourceId}
            </p>
            <p>
              <span className="font-medium">Événement :</span> {eventId}
            </p>
            <p className="text-xs text-muted-foreground">
              Lien valide jusqu&apos;au{" "}
              {new Date(expiresAt).toLocaleString("fr-FR", {
                dateStyle: "long",
                timeStyle: "short",
              })}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Vous pouvez modifier votre biographie, votre photo, et vos liens. Vos modifications
            seront soumises à validation par l&apos;organisateur.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Ce lien est personnel. Ne le partagez pas.
          </p>
        </CardContent>
      </Card>
    </PortalShell>
  );
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted/20 flex items-start justify-center p-6">
      <div className="w-full max-w-xl space-y-4">
        <header className="flex items-center gap-2 text-foreground">
          <KeyRound className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
          <span className="font-semibold">Portail Intervenant — Teranga Events</span>
        </header>
        {children}
      </div>
    </main>
  );
}

function ErrorBlock({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-2">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
