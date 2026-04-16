import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";
export const metadata: Metadata = {
  title: "Mot de passe oubli\u00e9",
};

export default async function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
