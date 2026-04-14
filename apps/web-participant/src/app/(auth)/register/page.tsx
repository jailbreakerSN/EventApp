import type { Metadata } from "next";
import { RegisterForm } from "./register-form";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Inscription",
};

export default async function RegisterPage() {
  const _t = await getTranslations("common"); void _t;
  return <RegisterForm />;
}
