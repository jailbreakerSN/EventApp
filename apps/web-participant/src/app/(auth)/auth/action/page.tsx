import type { Metadata } from "next";
import { AuthActionHandler } from "./auth-action-handler";

export const metadata: Metadata = {
  // Auth-action URLs are single-use and transient — never worth indexing,
  // and appearing in search would leak OOB codes if a user accidentally
  // shares the URL. Belt-and-braces on top of the nofollow we set in the
  // response headers.
  robots: { index: false, follow: false },
};

/**
 * Firebase Auth "action URL" handler — the landing page for email
 * verification and password reset links that the API mints via
 * admin.auth().generate{EmailVerification,PasswordReset}Link().
 *
 * Firebase appends `?mode=verifyEmail|resetPassword&oobCode=...&apiKey=...`
 * to whatever `url` we passed in actionCodeSettings. This route picks the
 * mode up, applies the action via the Firebase Client SDK, and renders a
 * branded success / failure panel. No Firebase-hosted pages are used at
 * any point — the whole flow stays on app.terangaevent.com.
 */
export default function AuthActionPage() {
  return <AuthActionHandler />;
}
