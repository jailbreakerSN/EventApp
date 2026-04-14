"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { useIdleTimeout } from "./use-idle-timeout";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
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
    if (firebaseAuth.currentUser) {
      await sendEmailVerification(firebaseAuth.currentUser);
    }
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(firebaseAuth, email);
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
