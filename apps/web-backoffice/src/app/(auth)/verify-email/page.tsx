"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getAuth } from "firebase/auth";
import { Button } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { ThemeLogo } from "@/components/theme-logo";
import { useTranslations } from "next-intl";

export default function VerifyEmailPage() {
  const _t = useTranslations("common"); void _t;
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
      toast.success("Email de v\u00e9rification envoy\u00e9 !");
    } catch {
      toast.error("Impossible d'envoyer l'email. R\u00e9essayez dans quelques minutes.");
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
        toast.info("Email toujours non v\u00e9rifi\u00e9. V\u00e9rifiez votre bo\u00eete de r\u00e9ception.");
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-md bg-card rounded-2xl shadow-2xl p-8 space-y-6">
      <div className="flex flex-col items-center text-center">
        <ThemeLogo
          width={160}
          height={95}
          className="h-12 w-auto mb-4"
          priority
        />
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teranga-gold/10 mb-4">
          <Mail className="h-8 w-8 text-teranga-gold-dark" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-card-foreground">V\u00e9rifiez votre email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {user?.email
            ? `Un email de v\u00e9rification a \u00e9t\u00e9 envoy\u00e9 \u00e0 ${user.email}. Consultez votre bo\u00eete de r\u00e9ception (et vos spams).`
            : "Un email de v\u00e9rification a \u00e9t\u00e9 envoy\u00e9. Consultez votre bo\u00eete de r\u00e9ception."}
        </p>
      </div>

      <div className="space-y-3">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleResend}
          disabled={sending}
        >
          {sending ? "Envoi en cours..." : "Renvoyer l'email de v\u00e9rification"}
        </Button>

        <Button
          className="w-full"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          {refreshing ? "V\u00e9rification..." : "J'ai v\u00e9rifi\u00e9 \u2014 rafra\u00eechir"}
        </Button>
      </div>

      <div className="flex items-center justify-between pt-2 text-sm">
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
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
  );
}
