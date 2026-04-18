import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "../_components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Mot de passe oublié",
};

export default async function ForgotPasswordPage() {
  const _t = await getTranslations("common");
  void _t;
  return (
    <AuthShell
      heroTitle={
        <>
          Reprenez la main sur
          <br />
          <em className="font-serif-display italic text-teranga-gold-light">votre compte.</em>
        </>
      }
      heroLead="Nous vous envoyons un lien sécurisé pour réinitialiser votre mot de passe en quelques secondes."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
