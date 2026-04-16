import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("register") };
}

export default async function RegisterPage() {
  return <RegisterForm />;
}
