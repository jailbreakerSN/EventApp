"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
  type AuthError,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { Button, buttonVariants, FormField } from "@teranga/shared-ui";

// Backoffice equivalent of apps/web-participant/src/app/(auth)/auth/action/
// auth-action-handler.tsx. Same state-machine + Firebase Client SDK
// pattern; the visual shell differs because the backoffice already
// renders pages inside an <AuthShell> (editorial split view), so this
// handler only needs to render the form column.
//
// No i18n — the backoffice is French-only today (matches the forgot-
// password form sibling). When the backoffice picks up next-intl for
// its auth surface, copy moves into messages/*.json and both apps can
// share a common fr/en/wo dictionary for the action page.

type Phase =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "verify-success" }
  | { kind: "verify-failed" }
  | { kind: "reset-form"; email: string; oobCode: string }
  | { kind: "reset-success" }
  | { kind: "reset-failed" };

const PASSWORD_MIN = 8;

export function AuthActionHandler() {
  const params = useSearchParams();
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    if (!mode || !oobCode) {
      setPhase({ kind: "unsupported" });
      return;
    }

    if (mode === "verifyEmail") {
      let cancelled = false;
      applyActionCode(firebaseAuth, oobCode)
        .then(() => {
          if (!cancelled) setPhase({ kind: "verify-success" });
        })
        .catch(() => {
          if (!cancelled) setPhase({ kind: "verify-failed" });
        });
      return () => {
        cancelled = true;
      };
    }

    if (mode === "resetPassword") {
      let cancelled = false;
      verifyPasswordResetCode(firebaseAuth, oobCode)
        .then((email) => {
          if (!cancelled) setPhase({ kind: "reset-form", email, oobCode });
        })
        .catch(() => {
          if (!cancelled) setPhase({ kind: "reset-failed" });
        });
      return () => {
        cancelled = true;
      };
    }

    setPhase({ kind: "unsupported" });
  }, [mode, oobCode]);

  if (phase.kind === "loading") {
    return (
      <StatusPanel
        title="Traitement de votre demande"
        message="Merci de patienter quelques instants..."
      />
    );
  }

  if (phase.kind === "unsupported") {
    return (
      <StatusPanel
        title="Lien invalide"
        message="Ce lien est invalide ou a expiré. Veuillez demander un nouveau lien."
        primaryCtaHref="/login"
        primaryCtaLabel="Retour à la connexion"
      />
    );
  }

  if (phase.kind === "verify-success") {
    return (
      <StatusPanel
        tone="success"
        title="Adresse confirmée"
        message="Votre adresse e-mail est maintenant vérifiée. Vous pouvez vous connecter pour accéder au back-office."
        primaryCtaHref="/login"
        primaryCtaLabel="Aller à la connexion"
      />
    );
  }

  if (phase.kind === "verify-failed") {
    return (
      <StatusPanel
        title="Vérification échouée"
        message="Le lien de vérification est invalide ou a expiré. Veuillez demander un nouvel e-mail."
        primaryCtaHref="/login"
        primaryCtaLabel="Retour à la connexion"
      />
    );
  }

  if (phase.kind === "reset-form") {
    return (
      <ResetPasswordForm
        email={phase.email}
        oobCode={phase.oobCode}
        onSuccess={() => setPhase({ kind: "reset-success" })}
        onError={() => setPhase({ kind: "reset-failed" })}
      />
    );
  }

  if (phase.kind === "reset-success") {
    return (
      <StatusPanel
        tone="success"
        title="Mot de passe mis à jour"
        message="Votre mot de passe a bien été mis à jour. Connectez-vous avec votre nouveau mot de passe."
        primaryCtaHref="/login"
        primaryCtaLabel="Aller à la connexion"
      />
    );
  }

  return (
    <StatusPanel
      title="Réinitialisation échouée"
      message="Le lien de réinitialisation est invalide ou a expiré. Veuillez en demander un nouveau."
      primaryCtaHref="/login"
      primaryCtaLabel="Retour à la connexion"
    />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface StatusPanelProps {
  title: string;
  message: string;
  primaryCtaHref?: string;
  primaryCtaLabel?: string;
  tone?: "success" | "neutral";
}

function StatusPanel({
  title,
  message,
  primaryCtaHref,
  primaryCtaLabel,
  tone = "neutral",
}: StatusPanelProps) {
  return (
    <div className="space-y-6 text-center">
      <div
        aria-hidden="true"
        className={`mx-auto text-4xl ${tone === "success" ? "text-teranga-green" : "text-muted-foreground"}`}
      >
        {tone === "success" ? "✓" : "ⓘ"}
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {primaryCtaHref && primaryCtaLabel && (
        <Link className={buttonVariants({ className: "w-full" })} href={primaryCtaHref}>
          {primaryCtaLabel}
        </Link>
      )}
    </div>
  );
}

interface ResetPasswordFormProps {
  email: string;
  oobCode: string;
  onSuccess: () => void;
  onError: () => void;
}

function ResetPasswordForm({ email, oobCode, onSuccess, onError }: ResetPasswordFormProps) {
  const schema = useMemo(
    () =>
      z
        .object({
          password: z
            .string()
            .min(PASSWORD_MIN, "Au moins 8 caractères")
            .regex(/[A-Z]/, "Au moins une majuscule")
            .regex(/\d/, "Au moins un chiffre"),
          confirmPassword: z.string(),
        })
        .refine((v) => v.password === v.confirmPassword, {
          path: ["confirmPassword"],
          message: "Les mots de passe ne correspondent pas",
        }),
    [],
  );

  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: { password: "", confirmPassword: "" },
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await confirmPasswordReset(firebaseAuth, oobCode, values.password);
      onSuccess();
    } catch (err) {
      void (err as AuthError); // fall through to generic failure state
      onError();
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Choisissez un nouveau mot de passe
        </h1>
        <p className="text-sm text-muted-foreground">Pour le compte {email}</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label="Nouveau mot de passe"
          htmlFor="new-password"
          required
          error={errors.password?.message}
        >
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...register("password")}
          />
        </FormField>

        <FormField
          label="Confirmer le mot de passe"
          htmlFor="confirm-password"
          required
          error={errors.confirmPassword?.message}
        >
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...register("confirmPassword")}
          />
        </FormField>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Mise à jour..." : "Mettre à jour le mot de passe"}
        </Button>
      </form>
    </div>
  );
}
