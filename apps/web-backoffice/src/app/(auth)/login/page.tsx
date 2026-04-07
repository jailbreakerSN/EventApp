import type { Metadata } from "next";
import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A1A2E] to-[#16213E] px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex justify-center mb-6">
            <Image src="/logo-color.svg" alt="Teranga Event" width={200} height={119} className="h-14 w-auto sm:h-16 md:h-20" priority />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">Connexion</h2>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
