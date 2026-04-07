"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@teranga/shared-ui";
import { Menu, X, User, LogOut } from "lucide-react";
import { useState } from "react";

export function Header() {
  const { user, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold text-teranga-navy">Teranga</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          <Link href="/events" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Événements
          </Link>
          {!loading && user && (
            <Link href="/my-events" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Mes inscriptions
            </Link>
          )}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <Link href="/profile" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                <User className="h-4 w-4" />
                {user.displayName ?? user.email}
              </Link>
              <Button variant="ghost" size="sm" onClick={logout} aria-label="Déconnexion">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">Connexion</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-teranga-gold text-white hover:bg-teranga-gold/90">
                  Inscription
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="border-t bg-white px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-3">
            <Link href="/events" className="text-sm font-medium" onClick={() => setMobileOpen(false)}>
              Événements
            </Link>
            {user && (
              <Link href="/my-events" className="text-sm font-medium" onClick={() => setMobileOpen(false)}>
                Mes inscriptions
              </Link>
            )}
            {user ? (
              <>
                <Link href="/profile" className="text-sm font-medium" onClick={() => setMobileOpen(false)}>
                  Mon profil
                </Link>
                <button className="text-left text-sm font-medium text-destructive" onClick={() => { logout(); setMobileOpen(false); }}>
                  Déconnexion
                </button>
              </>
            ) : (
              <div className="flex gap-2 pt-2">
                <Link href="/login" className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">Connexion</Button>
                </Link>
                <Link href="/register" className="flex-1">
                  <Button size="sm" className="w-full bg-teranga-gold text-white hover:bg-teranga-gold/90">
                    Inscription
                  </Button>
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
