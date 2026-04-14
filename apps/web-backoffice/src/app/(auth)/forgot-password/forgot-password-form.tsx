"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FormField } from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { ThemeLogo } from "@/components/theme-logo";

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

  return (
    <div className="bg-card rounded-2xl shadow-2xl p-8">
      <div className="flex justify-center mb-6">
        <ThemeLogo
          width={200}
          height={119}
          className="h-14 w-auto sm:h-16 md:h-20"
          priority
        />
      </div>
      <h2 className="text-xl font-semibold text-card-foreground mb-2 text-center">
        Mot de passe oubli&eacute;
      </h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        Entrez votre adresse email pour recevoir un lien de
        r&eacute;initialisation
      </p>

      {success ? (
        <div className="rounded-lg bg-green-500/10 p-4 text-sm text-green-700 dark:text-green-400 mb-4">
          Si un compte existe avec cet email, un lien de r&eacute;initialisation a
          &eacute;t&eacute; envoy&eacute; &agrave; <strong>{submittedEmail}</strong>.
          V&eacute;rifiez votre bo&icirc;te de r&eacute;ception.
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
              className="w-full border border-input bg-background rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              {...register("email")}
            />
          </FormField>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isSubmitting
              ? "Envoi en cours..."
              : "Envoyer le lien de r\u00e9initialisation"}
          </button>
        </form>
      )}

      <div className="mt-6 text-center">
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          Retour &agrave; la connexion
        </Link>
      </div>
    </div>
  );
}
