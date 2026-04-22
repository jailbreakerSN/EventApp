"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { useIdleTimeout } from "./use-idle-timeout";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { api, meApi } from "@/lib/api-client";
import type { UserRole } from "@teranga/shared-types";

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  roles: UserRole[];
  organizationId?: string;
  emailVerified: boolean;
  /** ISO string; sourced from firebaseUser.metadata.creationTime. */
  createdAt: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        const tokenResult = await firebaseUser.getIdTokenResult(true); // force refresh to get latest custom claims
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          roles: (tokenResult.claims.roles as UserRole[]) ?? ["participant"],
          organizationId: tokenResult.claims.organizationId as string | undefined,
          emailVerified: firebaseUser.emailVerified,
          createdAt: firebaseUser.metadata.creationTime
            ? new Date(firebaseUser.metadata.creationTime).toISOString()
            : null,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth, email, password);
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

  // ─── Session idle timeout (60 min for backoffice) ─────────────────────────
  const handleIdleWarning = useCallback(() => {
    toast.warning("Votre session va expirer dans 5 minutes en raison d'inactivité.");
  }, []);

  const handleIdleTimeout = useCallback(() => {
    toast.error("Session expirée. Veuillez vous reconnecter.");
    logout();
  }, []);

  useIdleTimeout({
    warningMs: 55 * 60 * 1000, // warn at 55 min
    timeoutMs: 60 * 60 * 1000, // logout at 60 min
    onWarning: handleIdleWarning,
    onTimeout: handleIdleTimeout,
    enabled: !!user,
  });

  const hasRole = (...roles: UserRole[]) => roles.some((r) => user?.roles.includes(r)) ?? false;

  const resendVerification = async () => {
    if (!firebaseAuth.currentUser) return;
    // Go through the API so the user gets our branded email (sent via
    // Resend, DMARC-aligned) instead of Firebase's default noreply@
    // firebase.com template. Audience=backoffice so the action link
    // lands on admin.terangaevent.com/auth/action.
    await api.post<{ success: boolean }>("/v1/auth/send-verification-email", {
      audience: "backoffice",
    });
  };

  const resetPassword = async (email: string) => {
    // Public / unauth'd. The API is anti-enumeration: same 200 response
    // whether the email is registered or not, so UI can always show
    // "check your inbox" without leaking account existence.
    await api.post<{ success: boolean; message: string }>(
      "/v1/auth/send-password-reset-email",
      { email, audience: "backoffice" },
      false,
    );
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, hasRole, resetPassword, resendVerification }}
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
