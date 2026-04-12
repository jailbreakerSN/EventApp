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
    await sendEmailVerification(credential.user);
  };

  const loginWithGoogle = async () => {
    // Use redirect flow (not popup) to avoid Cross-Origin-Opener-Policy
    // warnings from Chrome polling window.closed on the Google popup.
    // The redirect result is consumed in the useEffect above on app load.
    await signInWithRedirect(firebaseAuth, googleProvider);
  };

  const logout = async () => {
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
    if (firebaseAuth.currentUser) {
      await sendEmailVerification(firebaseAuth.currentUser);
    }
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(firebaseAuth, email);
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
