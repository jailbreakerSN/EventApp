"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { ThemeLogo } from "@/components/theme-logo";

export function ForgotPasswordForm() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(email);
      setSuccess(true);
    } catch {
      // Security best practice: don't reveal whether the email exists
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

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
          &eacute;t&eacute; envoy&eacute; &agrave; <strong>{email}</strong>.
          V&eacute;rifiez votre bo&icirc;te de r&eacute;ception.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-destructive text-sm bg-destructive/10 rounded-lg p-3">
              {error}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-card-foreground mb-1">
              Adresse email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@organisation.sn"
              required
              autoComplete="email"
              className="w-full border border-input bg-background rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {loading
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
