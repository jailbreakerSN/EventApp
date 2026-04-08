import Link from "next/link";
import { Search, Calendar, Users, Shield } from "lucide-react";
import { serverEventsApi } from "@/lib/server-api";
import { EventCard } from "@/components/event-card";
import type { Event } from "@teranga/shared-types";

export const revalidate = 60;

export default async function HomePage() {
  let featuredEvents: Event[] = [];
  try {
    const result = await serverEventsApi.search({ isFeatured: true, limit: 6 });
    featuredEvents = result.data;
  } catch {
    // fallback to empty
  }

  let latestEvents: Event[] = [];
  try {
    const result = await serverEventsApi.search({ limit: 6, orderBy: "createdAt", orderDir: "desc" });
    latestEvents = result.data;
  } catch {
    // fallback to empty
  }

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-teranga-navy to-teranga-navy/90 px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Découvrez les événements au{" "}
            <span className="text-teranga-gold">Sénégal</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/70">
            Conférences, concerts, ateliers et plus encore. Inscrivez-vous en quelques clics et recevez votre badge QR.
          </p>
          <div className="mt-8">
            <Link
              href="/events"
              className="inline-flex items-center gap-2 rounded-lg bg-teranga-gold px-6 py-3 text-base font-semibold text-white shadow-lg transition-colors hover:bg-teranga-gold/90"
            >
              <Search className="h-5 w-5" />
              Explorer les événements
            </Link>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-3">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teranga-gold/10">
              <Calendar className="h-6 w-6 text-teranga-gold" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Inscription simple</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Choisissez votre billet et inscrivez-vous en quelques secondes.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teranga-gold/10">
              <Shield className="h-6 w-6 text-teranga-gold" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Badge QR sécurisé</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Votre badge numérique avec QR code signé pour un accès rapide.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teranga-gold/10">
              <Users className="h-6 w-6 text-teranga-gold" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Communauté</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Rejoignez la communauté événementielle du Sénégal et de l&apos;Afrique de l&apos;Ouest.
            </p>
          </div>
        </div>
      </section>

      {/* Category quick filters */}
      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <h2 className="text-xl font-bold">Explorer par catégorie</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { slug: "conference", label: "Conférences", emoji: "🎤" },
            { slug: "workshop", label: "Ateliers", emoji: "🛠️" },
            { slug: "networking", label: "Networking", emoji: "🤝" },
            { slug: "concert", label: "Concerts", emoji: "🎵" },
            { slug: "festival", label: "Festivals", emoji: "🎪" },
            { slug: "training", label: "Formations", emoji: "📚" },
            { slug: "sport", label: "Sport", emoji: "⚽" },
          ].map(({ slug, label, emoji }) => (
            <Link
              key={slug}
              href={`/events?category=${slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-teranga-gold/10 hover:border-teranga-gold"
            >
              <span>{emoji}</span> {label}
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Events */}
      {featuredEvents.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Événements à la une</h2>
            <Link href="/events" className="text-sm font-medium text-teranga-gold-dark hover:underline">
              Voir tout
            </Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {/* Latest Events */}
      {latestEvents.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Derniers événements</h2>
            <Link href="/events" className="text-sm font-medium text-teranga-gold-dark hover:underline">
              Voir tout
            </Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {latestEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {/* CTA for organizers */}
      <section className="bg-muted px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold">Vous organisez un événement ?</h2>
          <p className="mt-3 text-muted-foreground">
            Créez et gérez vos événements avec Teranga. Billetterie, badges QR, check-in hors ligne et plus.
          </p>
          <a
            href={process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001"}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teranga-navy px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-teranga-navy/90"
            target="_blank"
            rel="noopener noreferrer"
          >
            Espace organisateur
          </a>
        </div>
      </section>
    </>
  );
}
