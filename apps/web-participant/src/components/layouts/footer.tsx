"use client";

import Link from "next/link";
import Image from "next/image";
import { Facebook, Twitter, Instagram, Linkedin } from "lucide-react";
import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("footer");
  const socialLinks = [
    {
      label: t("social.facebook"),
      href: "https://facebook.com/terangaevents",
      icon: Facebook,
    },
    {
      label: t("social.twitter"),
      href: "https://twitter.com/terangaevents",
      icon: Twitter,
    },
    {
      label: t("social.instagram"),
      href: "https://instagram.com/terangaevents",
      icon: Instagram,
    },
    {
      label: t("social.linkedin"),
      href: "https://linkedin.com/company/terangaevents",
      icon: Linkedin,
    },
  ];

  const discoverLinks = [
    { label: t("discover.allEvents"), href: "/events" },
    { label: t("discover.categories"), href: "/events?view=categories" },
    { label: t("discover.cities"), href: "/events?view=cities" },
    { label: t("discover.helpFaq"), href: "/faq" },
  ];

  const organizerLinks = [
    { label: t("organizers.createEvent"), href: "/login", internal: true },
    {
      label: t("organizers.dashboard"),
      href: process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001",
      internal: false,
    },
    { label: t("organizers.pricing"), href: "/pricing", internal: true },
  ];

  const legalLinks = [
    { label: t("legal.privacy"), href: "/privacy" },
    { label: t("legal.terms"), href: "/terms" },
    { label: t("legal.mentions"), href: "/legal" },
  ];

  return (
    <footer className="border-t bg-card text-foreground" aria-label={t("ariaLabel")}>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="flex flex-col gap-4">
            <Image
              src="/logo-white.svg"
              alt="Teranga Events"
              width={120}
              height={71}
              className="h-9 w-auto"
              aria-hidden="false"
            />
            <p className="text-sm text-muted-foreground leading-relaxed">{t("tagline")}</p>
            <div className="flex items-center gap-3 mt-1">
              {socialLinks.map(({ label, href, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Icon size={18} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {/* Discover */}
          <nav aria-label={t("discover.heading")}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("discover.heading")}
            </h2>
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
          </nav>

          {/* Organizers */}
          <nav aria-label={t("organizers.heading")}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("organizers.heading")}
            </h2>
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
          </nav>

          {/* Legal */}
          <nav aria-label={t("legal.heading")}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("legal.heading")}
            </h2>
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
          </nav>
        </div>

        <div className="mt-10 border-t border-border pt-6 flex flex-col items-center gap-1 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-xs text-muted-foreground">{t("copyright")}</p>
          <p className="text-xs text-muted-foreground">
            {t("madeWithLove")}
            <span className="sr-only"> — {t("madeWithLoveSr")}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
