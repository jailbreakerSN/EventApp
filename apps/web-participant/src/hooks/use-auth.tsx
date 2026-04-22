"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { useIdleTimeout } from "./use-idle-timeout";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { authEmailsApi, meApi } from "@/lib/api-client";
import type { UserRole } from "@teranga/shared-types";

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  roles: UserRole[];
  emailVerified: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Consume any pending Google sign-in redirect result. Safe to call on every
    // mount — returns null if no redirect is pending. Errors are toasted rather
    // than thrown to avoid breaking the auth provider initialization.
    getRedirectResult(firebaseAuth).catch((err) => {
      console.error("Google sign-in redirect error", err);
      toast.error("Échec de la connexion Google. Veuillez réessayer.");
    });

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        const tokenResult = await firebaseUser.getIdTokenResult();
        if (mounted) {
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            roles: (tokenResult.claims.roles as UserRole[]) ?? ["participant"],
            emailVerified: firebaseUser.emailVerified,
          });
        }
      } else if (mounted) {
        setUser(null);
      }
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  };

  const register = async (email: string, password: string, displayName: string) => {
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    await updateProfile(credential.user, { displayName });
    // Fire-and-forget: verification email goes through our API (Resend
    // + branded template), not Firebase's default mailer. A network
    // hiccup here shouldn't block sign-up completion — the Verify Email
    // page offers a "resend" button for that case.
    try {
      await authEmailsApi.sendVerification();
    } catch (err) {
      console.warn("Failed to send verification email after signup", err);
    }
  };

  const loginWithGoogle = async () => {
    // Use redirect flow (not popup) to avoid Cross-Origin-Opener-Policy
    // warnings from Chrome polling window.closed on the Google popup.
    // The redirect result is consumed in the useEffect above on app load.
    await signInWithRedirect(firebaseAuth, googleProvider);
  };

  const logout = async () => {
    // Phase C.2 — drop every FCM token tied to this account BEFORE the
    // Firebase session ends. If the network blip drops this call we
    // swallow it (signOut must still run); the server already caps at
    // 10 tokens/user so a stale entry self-evicts on next register. We
    // also clear the locally-cached fingerprint so the next sign-in on
    // the same browser re-registers cleanly rather than trying to revoke
    // a fingerprint that no longer exists server-side.
    try {
      await meApi.revokeAllFcmTokens();
    } catch {
      // Best-effort — don't block logout on push revoke.
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("teranga.push.fingerprint");
      } catch {
        // Private mode — ignore.
      }
    }
    await signOut(firebaseAuth);
  };

  // ─── Session idle timeout (30 min for participant) ────────────────────────
  const handleIdleWarning = useCallback(() => {
    toast.warning("Votre session va expirer dans 5 minutes en raison d'inactivité.");
  }, []);

  const handleIdleTimeout = useCallback(() => {
    toast.error("Session expirée. Veuillez vous reconnecter.");
    logout();
  }, []);

  useIdleTimeout({
    warningMs: 25 * 60 * 1000, // warn at 25 min
    timeoutMs: 30 * 60 * 1000, // logout at 30 min
    onWarning: handleIdleWarning,
    onTimeout: handleIdleTimeout,
    enabled: !!user,
  });

  const resendVerification = async () => {
    if (!firebaseAuth.currentUser) return;
    // Authenticated call — the API identifies the target email from
    // the caller's ID token. No email parameter on purpose: prevents
    // an attacker with a stolen token from spamming verification
    // emails at arbitrary addresses.
    await authEmailsApi.sendVerification();
  };

  const resetPassword = async (email: string) => {
    // Public / unauth'd call. The API does NOT surface whether the
    // address is on file (anti-enumeration) — the caller always gets
    // a generic 200 back, so the UI shows the same "check your inbox"
    // screen either way.
    await authEmailsApi.sendPasswordReset(email);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        loginWithGoogle,
        logout,
        resetPassword,
        resendVerification,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
