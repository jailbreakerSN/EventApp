import type { Metadata } from "next";
import { LoginForm } from "./login-form";
export const metadata: Metadata = {
  title: "Connexion",
};

export default async function LoginPage() {
  return <LoginForm />;
}
