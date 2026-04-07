"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { firebaseAuth } from "@/lib/firebase";
import { LoginSchema, type LoginDto } from "@teranga/shared-types";
import { useState } from "react";
import type { UserRole } from "@teranga/shared-types";

const BACKOFFICE_ROLES: UserRole[] = ["organizer", "co_organizer", "super_admin"];

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginDto>({ resolver: zodResolver(LoginSchema) });

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-card-foreground mb-1">
          Adresse email
        </label>
        <input
          {...register("email")}
          type="email"
          autoComplete="email"
          placeholder="vous@organisation.sn"
          className="w-full border border-input bg-background rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.email && (
          <p className="text-destructive text-xs mt-1">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-card-foreground mb-1">
          Mot de passe
        </label>
        <input
          {...register("password")}
          type="password"
          autoComplete="current-password"
          className="w-full border border-input bg-background rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.password && (
          <p className="text-destructive text-xs mt-1">{errors.password.message}</p>
        )}
      </div>

      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
          Mot de passe oubli&eacute; ?
        </Link>
      </div>

      {error && (
        <p className="text-destructive text-sm bg-destructive/10 rounded-lg p-3">{error}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {isSubmitting ? "Connexion..." : "Se connecter"}
      </button>
    </form>
  );
}
