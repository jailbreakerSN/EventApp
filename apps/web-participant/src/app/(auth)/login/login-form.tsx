"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { getAndClearRedirectUrl } from "@/components/auth-guard";
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
  password: z
    .string()
    .min(6, { message: "Le mot de passe doit contenir au moins 6 caractères" }),
});

type FormValues = z.infer<typeof schema>;

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
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields, dirtyFields, isSubmitting },
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(schema),
  });

  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const fieldState = (name: keyof FormValues): "idle" | "valid" | "error" => {
    if (errors[name]) return "error";
    if (touchedFields[name] && dirtyFields[name]) return "valid";
    return "idle";
  };

  const onSubmit = async ({ email, password }: FormValues) => {
    setError(null);
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
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      const savedUrl = safeRedirect(getAndClearRedirectUrl());
      router.push(savedUrl !== "/events" ? savedUrl : redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur de connexion Google";
      setError(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const loading = isSubmitting || googleLoading;

  return (
    <Card>
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 block">
          <ThemeLogo width={140} height={83} className="h-14 w-auto mx-auto sm:h-16 md:h-20" priority />
        </Link>
        <CardTitle className="text-2xl">Connexion</CardTitle>
        <CardDescription>Connectez-vous pour accéder à vos événements</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <FormField
            label="Email"
            required
            htmlFor="email"
            error={errors.email?.message}
            state={fieldState("email")}
          >
            <Input
              id="email"
              type="email"
              placeholder="votre@email.com"
              autoComplete="email"
              {...register("email")}
            />
          </FormField>

          <FormField
            label="Mot de passe"
            required
            htmlFor="password"
            error={errors.password?.message}
            state={fieldState("password")}
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
          </FormField>

          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Mot de passe oubli&eacute; ?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {isSubmitting ? "Connexion..." : "Se connecter"}
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
          <Link href={`/register?redirect=${encodeURIComponent(redirectTo)}`} className="font-medium text-teranga-gold-dark hover:underline">
            Créer un compte
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
