import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A1A2E] to-[#16213E] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white tracking-tight">Teranga</h1>
          <p className="text-[#F5A623] mt-1 text-sm">
            L&apos;Événementiel Africain, Connecté et Mémorable
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Connexion</h2>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
