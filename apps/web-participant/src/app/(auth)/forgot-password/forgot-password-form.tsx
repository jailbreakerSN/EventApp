"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { ThemeLogo } from "@/components/theme-logo";
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  FormField,
} from "@teranga/shared-ui";

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
        <CardTitle className="text-2xl">Mot de passe oubli&eacute;</CardTitle>
        <CardDescription>
          Entrez votre adresse email pour recevoir un lien de
          r&eacute;initialisation
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="rounded-md bg-green-500/10 p-4 text-sm text-green-700 dark:text-green-400">
            Si un compte existe avec cet email, un lien de r&eacute;initialisation a
            &eacute;t&eacute; envoy&eacute; &agrave; <strong>{submittedEmail}</strong>.
            V&eacute;rifiez votre bo&icirc;te de r&eacute;ception.
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              label="Email"
              htmlFor="email"
              required
              error={errors.email?.message}
              state={emailState}
            >
              <Input
                id="email"
                type="email"
                placeholder="votre@email.com"
                autoComplete="email"
                {...register("email")}
              />
            </FormField>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? "Envoi en cours..."
                : "Envoyer le lien de r\u00e9initialisation"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-teranga-gold-dark hover:underline"
          >
            Retour &agrave; la connexion
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
