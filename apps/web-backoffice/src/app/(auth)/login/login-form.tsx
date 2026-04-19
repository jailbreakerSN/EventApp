"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button, FormField, StatusPill } from "@teranga/shared-ui";
import { LoginSchema, type LoginDto } from "@teranga/shared-types";
import type { UserRole } from "@teranga/shared-types";
import { useAuth } from "@/hooks/use-auth";
import { firebaseAuth } from "@/lib/firebase";

const BACKOFFICE_ROLES: UserRole[] = ["organizer", "co_organizer", "super_admin"];

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginDto>({ resolver: zodResolver(LoginSchema), mode: "onBlur" });

  const onSubmit = async (data: LoginDto) => {
    setError(null);
    try {
      await login(data.email, data.password);

      // Check roles from token claims before redirecting
      const currentUser = firebaseAuth.currentUser;
      if (currentUser) {
        const tokenResult = await currentUser.getIdTokenResult(true);
        const roles = (tokenResult.claims.roles as UserRole[]) ?? ["participant"];
        if (!roles.some((r) => BACKOFFICE_ROLES.includes(r))) {
          router.push("/unauthorized");
          return;
        }
      }

      router.push("/dashboard");
    } catch {
      setError("Email ou mot de passe incorrect.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormField label="Adresse email" error={errors.email?.message} required htmlFor="email">
        <input
          id="email"
          {...register("email")}
          type="email"
          autoComplete="email"
          placeholder="vous@organisation.sn"
          aria-invalid={Boolean(errors.email) || undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </FormField>

      <FormField label="Mot de passe" error={errors.password?.message} required htmlFor="password">
        <input
          id="password"
          {...register("password")}
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password) || undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </FormField>

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Mot de passe oublié&nbsp;?
        </Link>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="flex justify-start">
          <StatusPill
            tone="danger"
            icon={<AlertCircle className="h-3 w-3" aria-hidden="true" />}
            label={error}
          />
        </div>
      )}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
      >
        {isSubmitting ? "Connexion..." : "Se connecter"}
      </Button>
    </form>
  );
}
