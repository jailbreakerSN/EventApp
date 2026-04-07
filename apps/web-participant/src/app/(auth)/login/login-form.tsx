"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { getAndClearRedirectUrl } from "@/components/auth-guard";
import Image from "next/image";
import { Button, Input, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@teranga/shared-ui";

function safeRedirect(url: string | null): string {
  if (!url) return "/events";
  // Only allow relative paths starting with / (block protocol-relative URLs like //evil.com)
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/events";
}

export function LoginForm() {
  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const savedUrl = safeRedirect(getAndClearRedirectUrl());
      router.push(savedUrl !== "/events" ? savedUrl : redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur de connexion";
      if (message.includes("invalid-credential") || message.includes("wrong-password") || message.includes("user-not-found")) {
        setError("Email ou mot de passe incorrect.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      const savedUrl = safeRedirect(getAndClearRedirectUrl());
      router.push(savedUrl !== "/events" ? savedUrl : redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur de connexion Google";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 block">
          <Image src="/logo-color.svg" alt="Teranga Event" width={140} height={83} className="h-12 w-auto mx-auto" priority />
        </Link>
        <CardTitle className="text-2xl">Connexion</CardTitle>
        <CardDescription>Connectez-vous pour accéder à vos événements</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <Input
              id="email"
              type="email"
              placeholder="votre@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">Mot de passe</label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Connexion..." : "Se connecter"}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">ou</span>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
          Continuer avec Google
        </Button>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Pas encore de compte ?{" "}
          <Link href={`/register?redirect=${encodeURIComponent(redirectTo)}`} className="font-medium text-teranga-gold hover:underline">
            Créer un compte
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
