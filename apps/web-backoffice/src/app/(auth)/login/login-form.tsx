"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { LoginSchema, type LoginDto } from "@teranga/shared-types";
import { useState } from "react";

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
      router.push("/dashboard");
    } catch {
      setError("Email ou mot de passe incorrect.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Adresse email
        </label>
        <input
          {...register("email")}
          type="email"
          autoComplete="email"
          placeholder="vous@organisation.sn"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]"
        />
        {errors.email && (
          <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Mot de passe
        </label>
        <input
          {...register("password")}
          type="password"
          autoComplete="current-password"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]"
        />
        {errors.password && (
          <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
        )}
      </div>

      {error && (
        <p className="text-red-500 text-sm bg-red-50 rounded-lg p-3">{error}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-[#1A1A2E] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors disabled:opacity-60"
      >
        {isSubmitting ? "Connexion..." : "Se connecter"}
      </button>
    </form>
  );
}
