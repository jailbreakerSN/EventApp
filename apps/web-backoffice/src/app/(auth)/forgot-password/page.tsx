import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Mot de passe oubli\u00e9",
};

export default async function ForgotPasswordPage() {
  const _t = await getTranslations("common"); void _t;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary/80 dark:from-background dark:to-muted px-4">
      <div className="w-full max-w-md">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
