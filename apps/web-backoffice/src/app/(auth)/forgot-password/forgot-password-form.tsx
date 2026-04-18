"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail } from "lucide-react";
import { Button, EmptyStateEditorial, FormField, SectionHeader } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  email: z
    .string()
    .trim()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Adresse email invalide" }),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const { resetPassword } = useAuth();
  const [success, setSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields, dirtyFields, isSubmitting },
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: { email: "" },
    resolver: zodResolver(schema),
  });

  const onSubmit = async ({ email }: FormValues) => {
    try {
      await resetPassword(email);
    } catch {
      // Security best practice: don't reveal whether the email exists.
    }
    setSubmittedEmail(email);
    setSuccess(true);
  };

  const emailState: "idle" | "valid" | "error" = errors.email
    ? "error"
    : touchedFields.email && dirtyFields.email
      ? "valid"
      : "idle";

  if (success) {
    return (
      <div className="space-y-6">
        <EmptyStateEditorial
          icon={Mail}
          kicker="— LIEN ENVOYÉ"
          title="Vérifiez votre boîte de réception"
          description={`Si un compte existe avec l'adresse ${submittedEmail}, un lien de réinitialisation vient d'être envoyé. Pensez à consulter vos spams.`}
          action={
            <Link href="/login">
              <Button variant="outline" className="rounded-full">
                Retour à la connexion
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="rounded-tile border border-border/60 bg-card p-8 shadow-sm md:p-10">
      <SectionHeader
        as="h1"
        kicker="— MOT DE PASSE OUBLIÉ"
        title="Réinitialisez votre accès"
        subtitle="Entrez l’adresse associée à votre compte organisateur. Nous vous enverrons un lien sécurisé."
      />

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
        <FormField
          label="Adresse email"
          htmlFor="email"
          required
          error={errors.email?.message}
          state={emailState}
        >
          <input
            id="email"
            type="email"
            placeholder="vous@organisation.sn"
            autoComplete="email"
            aria-invalid={Boolean(errors.email) || undefined}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary"
            {...register("email")}
          />
        </FormField>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
        >
          {isSubmitting ? "Envoi en cours..." : "Envoyer le lien de réinitialisation"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link
          href="/login"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
