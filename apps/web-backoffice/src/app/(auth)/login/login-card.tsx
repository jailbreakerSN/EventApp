"use client";

import { SectionHeader } from "@teranga/shared-ui";
import { LoginForm } from "./login-form";

export function LoginCard() {
  return (
    <div className="rounded-tile border border-border/60 bg-card p-8 shadow-sm md:p-10">
      <SectionHeader
        as="h1"
        kicker="— CONNEXION"
        title="Accédez à votre back-office"
        subtitle="Utilisez les identifiants de votre compte organisateur ou administrateur."
      />
      <div className="mt-8">
        <LoginForm />
      </div>
    </div>
  );
}
