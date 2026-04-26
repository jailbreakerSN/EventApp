/**
 * Organizer overhaul — Phase O10.
 *
 * Static catalog of 8 starter templates, each calibrated for the
 * Senegalese / West-African organizer market. Tickets are XOF-priced
 * with sane defaults; comms blueprints follow the conventions
 * established in the Phase O5 FR template library.
 *
 * Adding a new template: append to `EVENT_TEMPLATES` and bump the
 * test snapshot. The `id` must be lowercase kebab-case (URL-safe).
 */

import type { EventTemplate } from "./event-template.types";

const TEMPLATES: EventTemplate[] = [
  // ─── 1. Workshop ─────────────────────────────────────────────────────
  {
    id: "workshop",
    category: "workshop",
    label: "Atelier / Workshop",
    tagline: "Format intensif, jauge limitée, tarif unique.",
    description:
      "Idéal pour un atelier sur 1 demi-journée : 1 ticket unique, 1 session, rappels J-7 / J-1 / J+1.",
    icon: "GraduationCap",
    defaultDurationHours: 4,
    ticketTypes: [
      {
        id: "tt-workshop",
        name: "Standard",
        description: "Inscription unique avec accès à la session de formation.",
        price: 15_000,
        totalQuantity: 30,
        saleOpensOffsetDays: 30,
      },
    ],
    sessions: [
      {
        title: "Session principale",
        description: "Atelier interactif animé par le formateur.",
        offsetMinutes: 0,
        durationMinutes: 240,
        location: "Salle principale",
      },
    ],
    commsBlueprint: [
      {
        id: "wk-reminder-7d",
        offsetDays: -7,
        channels: ["email"],
        title: "Rappel J-7 — Préparez votre atelier",
        body: "L'atelier {event_title} approche. Pensez à apporter votre ordinateur et votre badge d'inscription.",
      },
      {
        id: "wk-reminder-1d",
        offsetDays: -1,
        channels: ["email", "sms"],
        title: "Demain, votre atelier !",
        body: "On vous attend demain à {event_start}. Le lien d'accès est dans votre mail de confirmation.",
      },
      {
        id: "wk-followup",
        offsetDays: 1,
        channels: ["email"],
        title: "Merci pour votre participation",
        body: "Voici le récap + les ressources de l'atelier. À très vite pour la prochaine édition !",
      },
    ],
    tags: ["formation", "atelier"],
  },

  // ─── 2. Conférence ───────────────────────────────────────────────────
  {
    id: "conference",
    category: "conference",
    label: "Conférence",
    tagline: "Plusieurs sessions, plusieurs intervenants, ticketing par catégorie.",
    description:
      "Configuration type pour une conférence professionnelle : 3 niveaux de tickets, sessions plénières + ateliers, comms étalées sur 6 semaines.",
    icon: "Mic",
    defaultDurationHours: 8,
    ticketTypes: [
      {
        id: "tt-conf-vip",
        name: "VIP",
        description: "Accès toutes sessions + cocktail networking.",
        price: 75_000,
        totalQuantity: 50,
        saleOpensOffsetDays: 60,
      },
      {
        id: "tt-conf-std",
        name: "Standard",
        description: "Accès à toutes les sessions plénières + 2 ateliers.",
        price: 30_000,
        totalQuantity: 300,
        saleOpensOffsetDays: 60,
      },
      {
        id: "tt-conf-student",
        name: "Étudiant",
        description: "Tarif étudiant sur présentation de la carte.",
        price: 10_000,
        totalQuantity: 100,
        saleOpensOffsetDays: 60,
      },
    ],
    sessions: [
      {
        title: "Plénière d'ouverture",
        offsetMinutes: 0,
        durationMinutes: 60,
        location: "Salle principale",
      },
      {
        title: "Atelier matin",
        offsetMinutes: 90,
        durationMinutes: 90,
        location: "Salle 1",
      },
      {
        title: "Pause déjeuner & networking",
        offsetMinutes: 240,
        durationMinutes: 60,
      },
      {
        title: "Plénière de clôture",
        offsetMinutes: 360,
        durationMinutes: 90,
        location: "Salle principale",
      },
    ],
    commsBlueprint: [
      {
        id: "conf-save-the-date",
        offsetDays: -42,
        channels: ["email"],
        title: "Save the date — {event_title}",
        body: "Bloquez la date dans votre agenda. Les inscriptions ouvrent dans quelques jours.",
      },
      {
        id: "conf-program-published",
        offsetDays: -28,
        channels: ["email"],
        title: "Le programme est en ligne",
        body: "Découvrez le programme complet et les intervenants confirmés. Réservez votre place.",
      },
      {
        id: "conf-reminder-7d",
        offsetDays: -7,
        channels: ["email", "push"],
        title: "Plus que 7 jours avant {event_title}",
        body: "Récapitulatif logistique, plan d'accès et lien d'accès au stream pour les hybrides.",
      },
      {
        id: "conf-d-day",
        offsetDays: 0,
        channels: ["push", "sms"],
        title: "Bienvenue à {event_title}",
        body: "Le check-in est ouvert. Présentez votre badge à l'entrée.",
      },
      {
        id: "conf-thank-you",
        offsetDays: 1,
        channels: ["email"],
        title: "Merci d'avoir participé !",
        body: "Le replay des sessions est disponible. Notre prochaine édition est déjà en préparation.",
      },
    ],
    tags: ["professionnel", "tech"],
  },

  // ─── 3. Gala / Soirée ─────────────────────────────────────────────────
  {
    id: "gala",
    category: "ceremony",
    label: "Gala / Soirée",
    tagline: "Soirée prestige, dress code, placement nominatif.",
    description:
      "Gala caritatif ou de fin d'année : 2 niveaux de tables (table 10 / individuel), comms premium, comms post-événement avec galerie photo.",
    icon: "PartyPopper",
    defaultDurationHours: 5,
    ticketTypes: [
      {
        id: "tt-gala-table",
        name: "Table 10 personnes",
        description: "Réservation d'une table complète + bouteille offerte.",
        price: 750_000,
        totalQuantity: 20,
        saleOpensOffsetDays: 90,
      },
      {
        id: "tt-gala-solo",
        name: "Place individuelle",
        description: "Place à table partagée.",
        price: 80_000,
        totalQuantity: 100,
        saleOpensOffsetDays: 90,
      },
    ],
    sessions: [
      {
        title: "Cocktail d'accueil",
        offsetMinutes: 0,
        durationMinutes: 60,
      },
      {
        title: "Dîner de gala",
        offsetMinutes: 60,
        durationMinutes: 180,
      },
      {
        title: "Soirée dansante",
        offsetMinutes: 240,
        durationMinutes: 60,
      },
    ],
    commsBlueprint: [
      {
        id: "gala-invitation",
        offsetDays: -45,
        channels: ["email"],
        title: "Invitation officielle — {event_title}",
        body: "Vous êtes cordialement invité(e) à notre gala annuel. Tenue de soirée souhaitée.",
      },
      {
        id: "gala-reminder",
        offsetDays: -7,
        channels: ["email", "sms"],
        title: "Plus que 7 jours",
        body: "Confirmez votre présence et téléchargez votre carton d'invitation.",
      },
      {
        id: "gala-thank-you",
        offsetDays: 2,
        channels: ["email"],
        title: "Merci pour cette belle soirée",
        body: "Retrouvez la galerie photo et les moments forts en ligne.",
      },
    ],
    tags: ["prestige", "soirée"],
  },

  // ─── 4. Hackathon ─────────────────────────────────────────────────────
  {
    id: "hackathon",
    category: "conference",
    label: "Hackathon",
    tagline: "Format 24-48h, gratuit ou symbolique, équipes.",
    description:
      "Marathon de code : ticket gratuit ou symbolique, sessions de 24-48 h, briefs + cérémonie de remise des prix.",
    icon: "Code",
    defaultDurationHours: 48,
    ticketTypes: [
      {
        id: "tt-hack-team",
        name: "Inscription équipe",
        description: "Une équipe = 1 inscription, jusqu'à 5 hackeurs.",
        price: 0,
        totalQuantity: 50,
        saleOpensOffsetDays: 60,
      },
    ],
    sessions: [
      {
        title: "Cérémonie d'ouverture + brief",
        offsetMinutes: 0,
        durationMinutes: 60,
      },
      {
        title: "Démo des projets",
        offsetMinutes: 2700, // 45 h
        durationMinutes: 120,
      },
      {
        title: "Remise des prix",
        offsetMinutes: 2820, // 47 h
        durationMinutes: 60,
      },
    ],
    commsBlueprint: [
      {
        id: "hack-savedate",
        offsetDays: -30,
        channels: ["email"],
        title: "Hackathon {event_title} — formez votre équipe",
        body: "Inscrivez votre équipe avant la fin des inscriptions. Formats, prix et règlement en ligne.",
      },
      {
        id: "hack-d1",
        offsetDays: -1,
        channels: ["email", "push"],
        title: "Dernier brief avant le lancement",
        body: "Récapitulatif logistique, accès wifi, planning des mentors, et coordonnées d'urgence.",
      },
      {
        id: "hack-followup",
        offsetDays: 1,
        channels: ["email"],
        title: "Bravo aux participants !",
        body: "Photos, vidéos des démos et retours des jurys disponibles en ligne.",
      },
    ],
    tags: ["tech", "compétition"],
  },

  // ─── 5. Kickoff interne ──────────────────────────────────────────────
  {
    id: "kickoff-interne",
    category: "networking",
    label: "Kickoff interne",
    tagline: "Réunion plénière entreprise, gratuit, accès collaborateurs.",
    description:
      "Annual / quarterly kickoff : ticket gratuit, audience scoped à l'entreprise, comms ciblées.",
    icon: "Building",
    defaultDurationHours: 4,
    ticketTypes: [
      {
        id: "tt-kickoff-team",
        name: "Collaborateur",
        description: "Inscription gratuite pour l'équipe.",
        price: 0,
        totalQuantity: null,
        saleOpensOffsetDays: 14,
      },
    ],
    sessions: [
      {
        title: "Mot du CEO",
        offsetMinutes: 0,
        durationMinutes: 30,
      },
      {
        title: "Bilan de l'année",
        offsetMinutes: 30,
        durationMinutes: 60,
      },
      {
        title: "Roadmap & Q&A",
        offsetMinutes: 90,
        durationMinutes: 90,
      },
      {
        title: "Cocktail d'équipe",
        offsetMinutes: 180,
        durationMinutes: 60,
      },
    ],
    commsBlueprint: [
      {
        id: "kickoff-savedate",
        offsetDays: -14,
        channels: ["email"],
        title: "Kickoff {event_title} — bloquez votre agenda",
        body: "Rendez-vous le {event_start} pour notre kickoff annuel.",
      },
      {
        id: "kickoff-reminder",
        offsetDays: -1,
        channels: ["email", "in_app"],
        title: "Demain, on se retrouve !",
        body: "Détails logistiques + lien Zoom pour les collaborateurs à distance.",
      },
    ],
    tags: ["interne", "entreprise"],
  },

  // ─── 6. Cours en ligne ───────────────────────────────────────────────
  {
    id: "cours-en-ligne",
    category: "training",
    label: "Cours en ligne",
    tagline: "Format hybride / 100 % distanciel, ticket unique, replay.",
    description:
      "Cours en ligne avec ticket unique, accès au stream, comms d'avant + de pendant + replay.",
    icon: "BookOpen",
    defaultDurationHours: 2,
    ticketTypes: [
      {
        id: "tt-online-std",
        name: "Cours en ligne",
        description: "Accès au cours en direct + replay 30 jours.",
        price: 5_000,
        totalQuantity: null,
        saleOpensOffsetDays: 30,
      },
    ],
    sessions: [
      {
        title: "Cours principal",
        offsetMinutes: 0,
        durationMinutes: 120,
      },
    ],
    commsBlueprint: [
      {
        id: "online-confirmation",
        offsetDays: -7,
        channels: ["email"],
        title: "Votre cours en ligne — préparation",
        body: "Lien Zoom + supports + check technique 24 h avant le début.",
      },
      {
        id: "online-1h-before",
        offsetDays: 0,
        channels: ["email", "push"],
        title: "Le cours commence dans 1 h",
        body: "Connectez-vous via le lien dans votre mail de confirmation.",
      },
      {
        id: "online-replay",
        offsetDays: 1,
        channels: ["email"],
        title: "Le replay est disponible",
        body: "Retrouvez l'enregistrement et les supports pendant 30 jours.",
      },
    ],
    tags: ["en-ligne", "formation"],
  },

  // ─── 7. Événement religieux ──────────────────────────────────────────
  {
    id: "evenement-religieux",
    category: "ceremony",
    label: "Événement religieux",
    tagline: "Cérémonie, gratuite, jauge importante, communication communautaire.",
    description:
      "Magal, Gamou, ou cérémonie de communauté : entrée gratuite, accent sur les comms communautaires (SMS + WhatsApp).",
    icon: "HeartHandshake",
    defaultDurationHours: 6,
    ticketTypes: [
      {
        id: "tt-religious-free",
        name: "Entrée gratuite",
        description: "Accès libre — inscription pour faciliter le check-in.",
        price: 0,
        totalQuantity: null,
        saleOpensOffsetDays: 30,
      },
    ],
    sessions: [
      {
        title: "Cérémonie principale",
        offsetMinutes: 0,
        durationMinutes: 240,
      },
      {
        title: "Repas communautaire",
        offsetMinutes: 240,
        durationMinutes: 120,
      },
    ],
    commsBlueprint: [
      {
        id: "religious-savedate",
        offsetDays: -14,
        channels: ["email", "whatsapp"],
        title: "{event_title} — Bissimilahi",
        body: "Inscrivez-vous pour faciliter votre accueil. Le programme complet est en ligne.",
      },
      {
        id: "religious-reminder",
        offsetDays: -1,
        channels: ["sms", "whatsapp"],
        title: "Demain, retrouvons-nous",
        body: "Plan d'accès et consignes de stationnement.",
      },
    ],
    tags: ["communauté", "cérémonie"],
  },

  // ─── 8. Mariage / Baptême ────────────────────────────────────────────
  {
    id: "mariage-bapteme",
    category: "ceremony",
    label: "Mariage / Baptême",
    tagline: "Cérémonie privée, invitation nominative, comms intimistes.",
    description:
      "Cérémonie familiale : invitation nominative, ticket gratuit, comms par famille + WhatsApp.",
    icon: "Sparkles",
    defaultDurationHours: 8,
    ticketTypes: [
      {
        id: "tt-fam-adult",
        name: "Adulte",
        description: "Invitation adulte avec accès à la cérémonie + repas.",
        price: 0,
        totalQuantity: null,
        saleOpensOffsetDays: 60,
      },
      {
        id: "tt-fam-child",
        name: "Enfant",
        description: "Invitation enfant — accès à la cérémonie.",
        price: 0,
        totalQuantity: null,
        saleOpensOffsetDays: 60,
      },
    ],
    sessions: [
      {
        title: "Cérémonie",
        offsetMinutes: 0,
        durationMinutes: 120,
      },
      {
        title: "Réception",
        offsetMinutes: 180,
        durationMinutes: 240,
      },
    ],
    commsBlueprint: [
      {
        id: "fam-invitation",
        offsetDays: -45,
        channels: ["email", "whatsapp"],
        title: "Vous êtes invité(e) à notre {event_title}",
        body: "Confirmez votre présence et celle de votre famille avant la fin du mois.",
      },
      {
        id: "fam-reminder",
        offsetDays: -3,
        channels: ["whatsapp", "sms"],
        title: "Plus que 3 jours",
        body: "Tenue souhaitée, plan d'accès, et coordonnées des coordinateurs sur place.",
      },
      {
        id: "fam-thank-you",
        offsetDays: 2,
        channels: ["email", "whatsapp"],
        title: "Merci pour ce beau moment",
        body: "Galerie photo + vidéo de la cérémonie disponibles en ligne.",
      },
    ],
    tags: ["famille", "cérémonie"],
  },
];

export const EVENT_TEMPLATES: ReadonlyArray<EventTemplate> = TEMPLATES;

/** Lookup helper. Returns `null` for unknown ids (no throw). */
export function findTemplate(id: string): EventTemplate | null {
  return EVENT_TEMPLATES.find((t) => t.id === id) ?? null;
}
