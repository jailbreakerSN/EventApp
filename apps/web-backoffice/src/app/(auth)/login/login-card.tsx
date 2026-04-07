"use client";

import { ThemeLogo } from "@/components/theme-logo";
import { LoginForm } from "./login-form";

export function LoginCard() {
  return (
    <div className="bg-card rounded-2xl shadow-2xl p-8">
      <div className="flex justify-center mb-6">
        <ThemeLogo width={200} height={119} className="h-14 w-auto sm:h-16 md:h-20" priority />
      </div>
      <h2 className="text-xl font-semibold text-card-foreground mb-6 text-center">Connexion</h2>
      <LoginForm />
    </div>
  );
}
