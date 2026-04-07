import type { Metadata } from "next";
import { LoginCard } from "./login-card";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary/80 dark:from-background dark:to-muted px-4">
      <div className="w-full max-w-md">
        <LoginCard />
      </div>
    </div>
  );
}
