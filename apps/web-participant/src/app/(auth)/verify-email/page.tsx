"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@teranga/shared-ui";

export default function VerifyEmailPage() {
  const { user, loading, resendVerification } = useAuth();
  const router = useRouter();
  const [sending, setSending] = useState(false);

  // If already verified, redirect to events
  if (!loading && user?.emailVerified) {
    router.replace("/events");
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

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teranga-gold/10">
          <Mail className="h-8 w-8 text-teranga-gold-dark" aria-hidden="true" />
        </div>
        <CardTitle className="text-2xl">Vérifiez votre email</CardTitle>
        <CardDescription>
          {user?.email
            ? `Un email de vérification a été envoyé à ${user.email}. Consultez votre boîte de réception (et vos spams).`
            : "Un email de vérification a été envoyé. Consultez votre boîte de réception."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleResend}
          disabled={sending}
        >
          {sending ? "Envoi en cours..." : "Renvoyer l'email de vérification"}
        </Button>
      </CardContent>
      <CardFooter className="justify-center">
        <Link
          href="/events"
          className="text-sm font-medium text-teranga-gold-dark hover:underline"
        >
          Continuer vers les événements
        </Link>
      </CardFooter>
    </Card>
  );
}
