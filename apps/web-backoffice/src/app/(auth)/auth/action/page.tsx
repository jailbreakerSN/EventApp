import type { Metadata } from "next";
import { AuthShell } from "../../_components/auth-shell";
import { AuthActionHandler } from "./auth-action-handler";

export const metadata: Metadata = {
  title: "Vérification",
  robots: { index: false, follow: false },
};

/**
 * Firebase Auth "action URL" handler for the backoffice (organizer / staff
 * signups). Minted by apps/api/src/services/auth-email.service.ts with
 * actionCodeSettings.url pointing here; flow is identical to the
 * participant app's /auth/action page but lives on admin.terangaevent.com
 * so organizers never bounce through the participant domain after
 * verifying or resetting their password.
 */
export default function AuthActionPage() {
  return (
    <AuthShell
      heroTitle={
        <>
          Une seconde,
          <br />
          <em className="font-serif-display italic text-teranga-gold-light">
            on vous ouvre la porte.
          </em>
        </>
      }
      heroLead="Nous finalisons la vérification de votre compte avant que vous preniez la main sur la plateforme."
    >
      <AuthActionHandler />
    </AuthShell>
  );
}
