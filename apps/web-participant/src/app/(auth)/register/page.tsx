import type { Metadata } from "next";
import { RegisterForm } from "./register-form";
export const metadata: Metadata = {
  title: "Inscription",
};

export default async function RegisterPage() {
  return <RegisterForm />;
}
