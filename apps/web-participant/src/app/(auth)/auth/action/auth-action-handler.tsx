"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
  type AuthError,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { ThemeLogo } from "@/components/theme-logo";
import {
  Button,
  buttonVariants,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  FormField,
} from "@teranga/shared-ui";

// ─── AuthActionHandler ────────────────────────────────────────────────────
//
// Single-URL handler for every Firebase Auth action link. The URL shape
// (`?mode=verifyEmail|resetPassword&oobCode=...&apiKey=...&continueUrl=...`)
// is fixed by Firebase; we branch on `mode` and drive the flow from the
// browser using the Client SDK. The oobCode is server-verified by
// Firebase on every call (applyActionCode / confirmPasswordReset), so
// tampering with the URL can't succeed — only known-good codes flip
// account state.
//
// Three rendering states:
//   - loading      — while we resolve the initial mode.
//   - verifyEmail  — applyActionCode fires once and we show the result.
//   - resetPassword — two sub-states: "enter new password" form, then
//                     success / failure.
//
// Deliberately small: no analytics, no redirects. A stuck user (expired
// code, malformed URL) always sees a clear failure message + a Login CTA.

type Phase =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "verify-success" }
  | { kind: "verify-failed"; error?: string }
  | { kind: "reset-form"; email: string; oobCode: string }
  | { kind: "reset-success" }
  | { kind: "reset-failed"; error?: string };

const PASSWORD_MIN = 8;

export function AuthActionHandler() {
  const params = useSearchParams();
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");
  const t = useTranslations("auth.action");
  const tValidation = useTranslations("auth.validation");

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  // One-shot effect: decide what the mode is and kick off the right call.
  // Deliberately depends only on the URL parameters so a SPA nav to this
  // page with different params re-runs the handler cleanly.
  useEffect(() => {
    // Missing required params → permanent "invalid link" state.
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
        .catch((err: AuthError) => {
          if (!cancelled) {
            setPhase({ kind: "verify-failed", error: err.code });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (mode === "resetPassword") {
      // verifyPasswordResetCode: returns the email associated with the
      // code AND validates the code in one round-trip. We hold onto the
      // email for the new-password form header so users can confirm
      // which account they're resetting.
      let cancelled = false;
      verifyPasswordResetCode(firebaseAuth, oobCode)
        .then((email) => {
          if (!cancelled) setPhase({ kind: "reset-form", email, oobCode });
        })
        .catch((err: AuthError) => {
          if (!cancelled) {
            setPhase({ kind: "reset-failed", error: err.code });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setPhase({ kind: "unsupported" });
  }, [mode, oobCode]);

  return (
    <Card>
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 block">
          <ThemeLogo
            width={140}
            height={83}
            className="h-14 w-auto mx-auto sm:h-16 md:h-20"
            priority
          />
        </Link>
      </CardHeader>

      {phase.kind === "loading" && (
        <>
          <CardContent className="text-center">
            <CardTitle className="mb-2 text-xl">{t("loadingTitle")}</CardTitle>
            <CardDescription>{t("loadingSubtitle")}</CardDescription>
          </CardContent>
        </>
      )}

      {phase.kind === "unsupported" && (
        <StatusPanel
          title={t("invalidLinkTitle")}
          message={t("invalidLinkMessage")}
          primaryCtaLabel={t("goToLogin")}
          primaryCtaHref="/login"
        />
      )}

      {phase.kind === "verify-success" && (
        <StatusPanel
          title={t("verifySuccessTitle")}
          message={t("verifySuccessMessage")}
          primaryCtaLabel={t("goToEvents")}
          primaryCtaHref="/"
          secondaryCtaLabel={t("goToLogin")}
          secondaryCtaHref="/login"
          tone="success"
        />
      )}

      {phase.kind === "verify-failed" && (
        <StatusPanel
          title={t("verifyFailedTitle")}
          message={t("verifyFailedMessage")}
          primaryCtaLabel={t("goToLogin")}
          primaryCtaHref="/login"
        />
      )}

      {phase.kind === "reset-form" && (
        <ResetPasswordForm
          email={phase.email}
          oobCode={phase.oobCode}
          onSuccess={() => setPhase({ kind: "reset-success" })}
          onError={(code) => setPhase({ kind: "reset-failed", error: code })}
          t={t}
          tValidation={tValidation}
        />
      )}

      {phase.kind === "reset-success" && (
        <StatusPanel
          title={t("resetSuccessTitle")}
          message={t("resetSuccessMessage")}
          primaryCtaLabel={t("goToLogin")}
          primaryCtaHref="/login"
          tone="success"
        />
      )}

      {phase.kind === "reset-failed" && (
        <StatusPanel
          title={t("resetFailedTitle")}
          message={t("resetFailedMessage")}
          primaryCtaLabel={t("goToLogin")}
          primaryCtaHref="/login"
        />
      )}

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-teranga-gold-dark hover:underline">
            {t("goToLogin")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface StatusPanelProps {
  title: string;
  message: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  tone?: "success" | "neutral";
}

function StatusPanel({
  title,
  message,
  primaryCtaLabel,
  primaryCtaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  tone = "neutral",
}: StatusPanelProps) {
  return (
    <CardContent className="text-center">
      <div
        aria-hidden="true"
        className={`mx-auto mb-3 text-4xl ${
          tone === "success" ? "text-teranga-green" : "text-muted-foreground"
        }`}
      >
        {tone === "success" ? "✓" : "ⓘ"}
      </div>
      <CardTitle className="mb-2 text-xl">{title}</CardTitle>
      <CardDescription className="mb-6">{message}</CardDescription>
      <div className="flex flex-col gap-3">
        {/* shared-ui Button doesn't wrap with Radix Slot, so we style a
            <Link> with buttonVariants for the single-element link CTA. */}
        <Link className={buttonVariants({ className: "w-full" })} href={primaryCtaHref}>
          {primaryCtaLabel}
        </Link>
        {secondaryCtaLabel && secondaryCtaHref && (
          <Link
            href={secondaryCtaHref}
            className="text-sm font-medium text-teranga-gold-dark hover:underline"
          >
            {secondaryCtaLabel}
          </Link>
        )}
      </div>
    </CardContent>
  );
}

interface ResetPasswordFormProps {
  email: string;
  oobCode: string;
  onSuccess: () => void;
  onError: (code: string) => void;
  t: ReturnType<typeof useTranslations>;
  tValidation: ReturnType<typeof useTranslations>;
}

function ResetPasswordForm({
  email,
  oobCode,
  onSuccess,
  onError,
  t,
  tValidation,
}: ResetPasswordFormProps) {
  // Schema built inline so validation messages pick up the current
  // locale without a stale closure. useMemo because react-hook-form's
  // resolver reference stability matters for re-render count.
  const schema = useMemo(
    () =>
      z
        .object({
          password: z
            .string()
            .min(PASSWORD_MIN, tValidation("passwordMin8"))
            .regex(/[A-Z]/, tValidation("passwordUppercase"))
            .regex(/\d/, tValidation("passwordDigit")),
          confirmPassword: z.string(),
        })
        .refine((v) => v.password === v.confirmPassword, {
          path: ["confirmPassword"],
          message: t("passwordsDoNotMatch"),
        }),
    [t, tValidation],
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
      const code = (err as AuthError)?.code ?? "unknown";
      onError(code);
    }
  };

  return (
    <CardContent>
      <CardTitle className="mb-2 text-xl">{t("newPasswordTitle")}</CardTitle>
      <CardDescription className="mb-6">{t("newPasswordSubtitle", { email })}</CardDescription>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t("newPasswordLabel")}
          htmlFor="new-password"
          required
          error={errors.password?.message}
        >
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            // Extra hardening: some password managers try to autofill
            // the current password for the site here, which is wrong.
            // `new-password` (rather than `current-password`) tells them
            // to generate / suggest a new one instead.
            {...register("password")}
          />
        </FormField>

        <FormField
          label={t("confirmPasswordLabel")}
          htmlFor="confirm-password"
          required
          error={errors.confirmPassword?.message}
        >
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
        </FormField>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("submittingNewPassword") : t("submitNewPassword")}
        </Button>
      </form>
    </CardContent>
  );
}

// Exported so tests can exercise the path-decision logic in isolation
// without a DOM. Not used by the page itself.
export async function __verifyActionForTests(mode: string | null, oobCode: string | null) {
  if (!mode || !oobCode) return "unsupported";
  if (mode === "verifyEmail") return "verify";
  if (mode === "resetPassword") {
    await checkActionCode(firebaseAuth, oobCode);
    return "reset";
  }
  return "unsupported";
}
