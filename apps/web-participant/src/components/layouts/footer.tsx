import Link from "next/link";
import Image from "next/image";
import { Facebook, Twitter, Instagram, Linkedin } from "lucide-react";

const socialLinks = [
  {
    label: "Suivez Teranga Events sur Facebook",
    href: "https://facebook.com/terangaevents",
    icon: Facebook,
  },
  {
    label: "Suivez Teranga Events sur Twitter / X",
    href: "https://twitter.com/terangaevents",
    icon: Twitter,
  },
  {
    label: "Suivez Teranga Events sur Instagram",
    href: "https://instagram.com/terangaevents",
    icon: Instagram,
  },
  {
    label: "Suivez Teranga Events sur LinkedIn",
    href: "https://linkedin.com/company/terangaevents",
    icon: Linkedin,
  },
];

const discoverLinks = [
  { label: "Tous les événements", href: "/events" },
  { label: "Catégories populaires", href: "/events?view=categories" },
  { label: "Villes", href: "/events?view=cities" },
  { label: "Aide & FAQ", href: "/faq" },
];

const organizerLinks = [
  {
    label: "Créer un événement",
    href: "/login",
    internal: true,
  },
  {
    label: "Tableau de bord",
    href:
      process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001",
    internal: false,
  },
  { label: "Tarification", href: "/pricing", internal: true },
];

const legalLinks = [
  { label: "Politique de confidentialité", href: "/privacy" },
  { label: "Conditions d'utilisation", href: "/terms" },
  { label: "Mentions légales", href: "/legal" },
];

export function Footer() {
  return (
    <footer className="border-t bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Main grid */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="flex flex-col gap-4">
            <Image
              src="/logo-white.svg"
              alt="Teranga Events"
              width={120}
              height={71}
              className="h-9 w-auto"
            />
            <p className="text-sm text-muted-foreground leading-relaxed">
              La plateforme événementielle du Sénégal.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-3 mt-1">
              {socialLinks.map(({ label, href, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Icon size={18} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {/* Découvrir */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Découvrir
            </h4>
            <ul className="mt-4 space-y-2">
              {discoverLinks.map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Organisateurs */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Organisateurs
            </h4>
            <ul className="mt-4 space-y-2">
              {organizerLinks.map(({ label, href, internal }) => (
                <li key={href}>
                  {internal ? (
                    <Link
                      href={href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {label}
                    </Link>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Légal */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Légal
            </h4>
            <ul className="mt-4 space-y-2">
              {legalLinks.map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 border-t border-border pt-6 flex flex-col items-center gap-1 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-xs text-muted-foreground">
            © 2026 Teranga Events. Tous droits réservés.
          </p>
          <p className="text-xs text-muted-foreground">
            Fait avec ❤️ au Sénégal
          </p>
        </div>
      </div>
    </footer>
  );
}
