import type { Metadata } from "next";
import { LoginCard } from "./login-card";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage() {
  const _t = await getTranslations("common"); void _t;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary/80 dark:from-background dark:to-muted px-4">
      <div className="w-full max-w-md">
        <LoginCard />
      </div>
    </div>
  );
}
