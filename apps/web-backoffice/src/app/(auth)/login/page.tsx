import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "../_components/auth-shell";
import { LoginCard } from "./login-card";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage() {
  const _t = await getTranslations("common");
  void _t;
  return (
    <AuthShell
      heroTitle={
        <>
          Bon retour,
          <br />
          <em className="font-serif-display italic text-teranga-gold-light">organisateur.</em>
        </>
      }
      heroLead="Pilotez vos événements, vos équipes et vos participants depuis un seul back-office, pensé pour l’hospitalité sénégalaise."
    >
      <LoginCard />
    </AuthShell>
  );
}
