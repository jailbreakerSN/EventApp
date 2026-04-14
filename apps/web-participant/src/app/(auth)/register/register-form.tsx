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

const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { message: "Ce champ est requis" }),
  email: z
    .string()
    .trim()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Adresse email invalide" }),
  password: z
    .string()
    .min(8, { message: "Le mot de passe doit contenir au moins 8 caractères" })
    .regex(/[A-Z]/, { message: "Le mot de passe doit contenir au moins une majuscule" })
    .regex(/[0-9]/, { message: "Le mot de passe doit contenir au moins un chiffre" }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

function safeRedirect(url: string | null): string {
  if (!url) return "/events";
  // Only allow relative paths starting with / (block protocol-relative URLs like //evil.com)
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/events";
}

export function RegisterForm() {
  const { register: registerUser, loginWithGoogle } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields, isSubmitting, dirtyFields },
  } = useForm<RegisterFormValues>({
    mode: "onBlur",
    defaultValues: { displayName: "", email: "", password: "" },
    resolver: zodResolver(registerSchema),
  });

  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const fieldState = (name: keyof RegisterFormValues): "idle" | "valid" | "error" => {
    if (errors[name]) return "error";
    if (touchedFields[name] && dirtyFields[name]) return "valid";
    return "idle";
  };

  const onSubmit = async (values: RegisterFormValues) => {
    setError(null);
    try {
      await registerUser(values.email, values.password, values.displayName);
      router.push("/verify-email");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'inscription";
      if (message.includes("email-already-in-use")) {
        setError("Un compte existe déjà avec cet email.");
      } else if (message.includes("weak-password")) {
        setError("Le mot de passe est trop faible.");
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
      setError(err instanceof Error ? err.message : "Erreur de connexion Google");
    } finally {
      setGoogleLoading(false);
    }
  };

  const loading = isSubmitting || googleLoading;

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
        <CardTitle className="text-2xl">Créer un compte</CardTitle>
        <CardDescription>Inscrivez-vous pour découvrir les événements</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <FormField
            label="Nom complet"
            required
            htmlFor="displayName"
            error={errors.displayName?.message}
            state={fieldState("displayName")}
          >
            <Input
              id="displayName"
              type="text"
              placeholder="Prénom Nom"
              autoComplete="name"
              {...register("displayName")}
            />
          </FormField>

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
            hint="Au moins 8 caractères, 1 majuscule, 1 chiffre"
          >
            <Input
              id="password"
              type="password"
              placeholder="Votre mot de passe"
              autoComplete="new-password"
              minLength={8}
              {...register("password")}
            />
          </FormField>

          <Button type="submit" className="w-full" disabled={loading}>
            {isSubmitting ? "Inscription..." : "Créer mon compte"}
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
          Déjà un compte ?{" "}
          <Link
            href={`/login?redirect=${encodeURIComponent(redirectTo)}`}
            className="font-medium text-teranga-gold-dark hover:underline"
          >
            Se connecter
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
