import Link from "next/link";
import { Search, Calendar, Users, Shield, Ticket, QrCode, Quote, ArrowRight } from "lucide-react";
import { serverEventsApi } from "@/lib/server-api";
import { EventCard } from "@/components/event-card";
import { Card, CardContent } from "@teranga/shared-ui";
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

      {/* Comment ca marche */}
      <section className="bg-muted/30 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Comment ça marche</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            En trois étapes simples, participez aux meilleurs événements du Sénégal.
          </p>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                step: 1,
                icon: Search,
                title: "Découvrez",
                description: "Parcourez les événements à venir à Dakar et au Sénégal",
              },
              {
                step: 2,
                icon: Ticket,
                title: "Inscrivez-vous",
                description: "Choisissez votre billet et inscrivez-vous en quelques clics",
              },
              {
                step: 3,
                icon: QrCode,
                title: "Participez",
                description: "Présentez votre badge QR et profitez de l\u2019événement",
              },
            ].map(({ step, icon: Icon, title, description }) => (
              <Card key={step} className="relative overflow-hidden border-none bg-card shadow-md">
                <CardContent className="p-6 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teranga-gold/10">
                    <Icon className="h-7 w-7 text-teranga-gold" />
                  </div>
                  <span className="mt-4 inline-block rounded-full bg-teranga-gold/10 px-3 py-1 text-xs font-semibold text-teranga-gold">
                    Étape {step}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-gradient-to-r from-teranga-navy to-teranga-navy/90 px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { value: "50+", label: "événements" },
            { value: "5 000+", label: "participants" },
            { value: "10+", label: "villes" },
            { value: "98%", label: "satisfaction" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <p className="text-4xl font-extrabold tracking-tight text-teranga-gold sm:text-5xl">
                {value}
              </p>
              <p className="mt-2 text-sm font-medium uppercase tracking-wider text-white/70">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Ce que disent nos utilisateurs</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                quote:
                  "Teranga a transformé la façon dont j\u2019organise mes événements. La gestion des inscriptions est incroyablement fluide.",
                name: "Amadou Diallo",
                role: "Organisateur",
              },
              {
                quote:
                  "L\u2019inscription est simple et le badge QR fonctionne parfaitement, même sans connexion.",
                name: "Fatou Sow",
                role: "Participante",
              },
              {
                quote:
                  "Le tableau de bord sponsor est excellent. J\u2019ai pu scanner les badges et collecter des leads facilement.",
                name: "Moussa Ndiaye",
                role: "Sponsor",
              },
            ].map(({ quote, name, role }) => (
              <Card key={name} className="border-none shadow-md">
                <CardContent className="p-6">
                  <Quote className="h-8 w-8 text-teranga-gold/30" />
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {quote}
                  </p>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teranga-gold/10 text-sm font-bold text-teranga-gold">
                      {name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{name}</p>
                      <p className="text-xs text-muted-foreground">{role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA for organizers */}
      <section className="bg-gradient-to-br from-teranga-navy to-teranga-navy/80 px-4 py-20 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">Vous organisez un événement ?</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/70">
            Créez-le gratuitement sur Teranga et atteignez des milliers de participants
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-teranga-gold px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-colors hover:bg-teranga-gold/90"
            >
              Commencer gratuitement
              <ArrowRight className="h-5 w-5" />
            </Link>
            <a
              href={process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3001"}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-6 py-3.5 text-base font-medium text-white transition-colors hover:bg-white/10"
              target="_blank"
              rel="noopener noreferrer"
            >
              Espace organisateur
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
