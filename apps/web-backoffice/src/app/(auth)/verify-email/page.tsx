"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getAuth } from "firebase/auth";
import { useTranslations } from "next-intl";
import { Button, EmptyStateEditorial, StatusPill } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { AuthShell } from "../_components/auth-shell";

export default function VerifyEmailPage() {
  const _t = useTranslations("common");
  void _t;
  const { user, loading, resendVerification, logout } = useAuth();
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Already verified → bounce to dashboard.
  if (!loading && user?.emailVerified) {
    router.replace("/dashboard");
    return null;
  }

  const handleResend = async () => {
    setSending(true);
    try {
      await resendVerification();
      toast.success("Email de vérification envoyé !");
    } catch {
      toast.error("Impossible d'envoyer l'email. Réessayez dans quelques minutes.");
    } finally {
      setSending(false);
    }
  };

  // Force-refresh the ID token so the fresh emailVerified flag propagates.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const current = getAuth().currentUser;
      if (current) {
        await current.reload();
        await current.getIdToken(true);
      }
      if (getAuth().currentUser?.emailVerified) {
        router.replace("/dashboard");
      } else {
        toast.info("Email toujours non vérifié. Vérifiez votre boîte de réception.");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const emailDescription = user?.email
    ? `Un lien de vérification a été envoyé à ${user.email}. Consultez votre boîte de réception (et vos spams).`
    : "Un lien de vérification a été envoyé. Consultez votre boîte de réception (et vos spams).";

  return (
    <AuthShell
      heroTitle={
        <>
          Une dernière étape
          <br />
          <em className="font-serif-display italic text-teranga-gold-light">avant d’entrer.</em>
        </>
      }
      heroLead="Nous protégeons votre compte en vérifiant votre adresse email. Confirmez le lien reçu puis revenez ici."
    >
      <div className="space-y-6">
        <EmptyStateEditorial
          icon={Mail}
          kicker="— VÉRIFICATION REQUISE"
          title="Vérifiez votre email"
          description={emailDescription}
        />

        <div className="flex justify-center">
          <StatusPill tone="warning" label="En attente de confirmation" />
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={handleResend}
            disabled={sending}
          >
            {sending ? "Envoi en cours..." : "Renvoyer l’email de vérification"}
          </Button>

          <Button
            className="w-full rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {refreshing ? "Vérification..." : "J’ai vérifié — rafraîchir"}
          </Button>
        </div>

        <div className="flex items-center justify-center pt-2 text-sm">
          <Link
            href="/login"
            className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={(e) => {
              e.preventDefault();
              // Redirect to /login regardless of whether signOut resolves —
              // otherwise a network failure would silently strand the user
              // on /verify-email with no feedback.
              logout()
                .catch(() => undefined)
                .finally(() => router.replace("/login"));
            }}
          >
            Changer de compte
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
