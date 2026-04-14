import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Mot de passe oubli\u00e9",
};

export default async function ForgotPasswordPage() {
  const _t = await getTranslations("common"); void _t;
  return <ForgotPasswordForm />;
}
