"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Spinner } from "@teranga/shared-ui";
import { newsletterApi } from "@/lib/api-client";

type FormState = "idle" | "success" | "error";

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { message: "Veuillez saisir votre adresse e-mail." })
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Adresse e-mail invalide." }),
});

type FormValues = z.infer<typeof schema>;

export function NewsletterSignup() {
  const [formState, setFormState] = useState<FormState>("idle");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: { email: "" },
    resolver: zodResolver(schema),
  });

  const onSubmit = async ({ email }: FormValues) => {
    try {
      await newsletterApi.subscribe(email.trim());
      setFormState("success");
      reset();
    } catch {
      setFormState("error");
    }
  };

  return (
    <section
      aria-labelledby="newsletter-heading"
      className="rounded-2xl bg-gradient-to-r from-teranga-navy/5 to-teranga-gold/5 px-6 py-12 dark:from-teranga-navy/20 dark:to-teranga-gold/10"
    >
      <div className="mx-auto max-w-2xl text-center">
        <h2
          id="newsletter-heading"
          className="text-2xl font-bold text-foreground sm:text-3xl"
        >
          Restez informé des événements au Sénégal
        </h2>
        <p className="mt-3 text-muted-foreground">
          Recevez chaque semaine les meilleurs événements près de chez vous.
        </p>

        {/* Status messages — announced to screen readers */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="mt-4 min-h-[1.5rem]"
        >
          {formState === "success" && (
            <p className="font-medium text-teranga-green">
              Merci&nbsp;! Vous êtes inscrit.
            </p>
          )}
          {formState === "error" && (
            <p className="font-medium text-destructive">
              Une erreur s&apos;est produite. Veuillez réessayer.
            </p>
          )}
        </div>

        {formState !== "success" && (
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="mt-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1">
                <Input
                  type="email"
                  placeholder="votre@email.com"
                  aria-label="Adresse e-mail pour la newsletter"
                  aria-describedby={errors.email ? "newsletter-email-error" : undefined}
                  aria-invalid={errors.email ? true : undefined}
                  disabled={isSubmitting}
                  className="w-full"
                  autoComplete="email"
                  {...register("email")}
                />
                {errors.email && (
                  <p
                    id="newsletter-email-error"
                    role="alert"
                    className="mt-1 text-left text-sm text-destructive"
                  >
                    {errors.email.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="shrink-0 bg-teranga-gold text-white hover:bg-teranga-gold-dark focus-visible:ring-teranga-gold"
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" className="mr-2 text-white" aria-label="Inscription en cours" />
                    Inscription…
                  </>
                ) : (
                  "S'inscrire"
                )}
              </Button>
            </div>
          </form>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          En vous inscrivant, vous acceptez notre{" "}
          <a
            href="/privacy"
            className="underline underline-offset-2 hover:text-foreground"
          >
            politique de confidentialité
          </a>
          .
        </p>
      </div>
    </section>
  );
}
