"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@teranga/shared-ui";

export default function VerifyEmailPage() {
  const tAuth = useTranslations("auth");
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
      toast.success(tAuth("verificationEmailSentToast"));
    } catch {
      toast.error(tAuth("verificationSendFailedToast"));
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
        <CardTitle className="text-2xl">{tAuth("verifyEmail")}</CardTitle>
        <CardDescription>
          {user?.email
            ? tAuth("verifyEmailSentTo", { email: user.email })
            : tAuth("verifyEmailSent")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" className="w-full" onClick={handleResend} disabled={sending}>
          {sending ? tAuth("resendingVerification") : tAuth("resendVerificationButton")}
        </Button>
      </CardContent>
      <CardFooter className="justify-center">
        <Link href="/events" className="text-sm font-medium text-teranga-gold-dark hover:underline">
          {tAuth("continueToEvents")}
        </Link>
      </CardFooter>
    </Card>
  );
}
