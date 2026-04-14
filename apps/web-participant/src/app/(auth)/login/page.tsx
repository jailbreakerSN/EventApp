import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Connexion",
};

export default async function LoginPage() {
  const _t = await getTranslations("common"); void _t;
  return <LoginForm />;
}
