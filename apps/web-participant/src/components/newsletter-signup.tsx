"use client";

import { useState } from "react";
import { Button, Input, Spinner } from "@teranga/shared-ui";

type FormState = "idle" | "submitting" | "success" | "error";

export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>("idle");

  function validateEmail(value: string): string | null {
    if (!value.trim()) return "Veuillez saisir votre adresse e-mail.";
    // Basic RFC-compatible check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      return "Adresse e-mail invalide.";
    }
    return null;
  }

  function handleBlur() {
    setEmailError(validateEmail(email));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const error = validateEmail(email);
    if (error) {
      setEmailError(error);
      return;
    }

    setEmailError(null);
    setFormState("submitting");

    try {
      // TODO: Replace with real API call once the newsletter endpoint is implemented.
      // Example:
      //   await fetch("/api/newsletter", {
      //     method: "POST",
      //     headers: { "Content-Type": "application/json" },
      //     body: JSON.stringify({ email }),
      //   });
      await new Promise((resolve) => setTimeout(resolve, 800)); // simulate network
      setFormState("success");
      setEmail("");
    } catch {
      setFormState("error");
    }
  }

  const isSubmitting = formState === "submitting";

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
            onSubmit={handleSubmit}
            noValidate
            className="mt-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1">
                <Input
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={handleBlur}
                  placeholder="votre@email.com"
                  aria-label="Adresse e-mail pour la newsletter"
                  aria-describedby={emailError ? "newsletter-email-error" : undefined}
                  aria-invalid={emailError ? true : undefined}
                  disabled={isSubmitting}
                  className="w-full"
                  autoComplete="email"
                />
                {emailError && (
                  <p
                    id="newsletter-email-error"
                    role="alert"
                    className="mt-1 text-left text-sm text-destructive"
                  >
                    {emailError}
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
