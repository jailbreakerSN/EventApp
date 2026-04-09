"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@teranga/shared-ui";

export function EmailVerificationBanner() {
  const { user, resendVerification } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);

  // Don't show if no user, already verified, or dismissed this session
  if (!user || user.emailVerified || dismissed) return null;

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

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200"
    >
      <p className="flex-1">
        Votre adresse email n&apos;est pas vérifiée.{" "}
        <button
          onClick={handleResend}
          disabled={sending}
          className="font-medium underline hover:no-underline disabled:opacity-50"
        >
          {sending ? "Envoi..." : "Renvoyer l'email"}
        </button>
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
        onClick={() => setDismissed(true)}
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
