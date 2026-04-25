/**
 * Sprint D — rich procedural dataset.
 *
 * Generates ~80 synthetic events and ~1 900 registrations to bring
 * the seed total to ≈ 100 events / ≈ 2 000 regs (Sprint A audit
 * target S7). The hand-crafted 22 events in `04-events.ts` and the
 * ~90 hand-crafted regs in `05-activity.ts` stay canonical for
 * narrative demos; this module exists purely to give admin
 * dashboards, calendar grids, and plan-limit visualisations the
 * volume they need to look real.
 *
 * Design rules:
 *   - **Deterministic.** A tiny Mulberry32 PRNG seeded with 0xC0FFEE
 *     produces identical output on every run. No `Math.random`.
 *   - **Schema-faithful.** Every event passes `EventSchema.parse`
 *     and every registration passes `RegistrationSchema.parse` (the
 *     `npm run seed:validate` CI guard catches drift).
 *   - **i18n.** Each event has `title.fr` (canonical) plus
 *     denormalised `titleEn` / `titleWo` mirrors so the demo
 *     surfaces aren't blank in EN / WO toggles.
 *   - **Plan-tier proportional.** The free-tier org caps at the
 *     free-plan limit (3 active events, 50 regs / event); pro and
 *     enterprise scale up but do NOT exceed `maxParticipantsPerEvent`
 *     so the seed itself is plan-correctness-safe.
 *
 * The procedural events are NOT given sessions, speakers, sponsors,
 * or sponsor leads — those fan-outs stay coupled to the canonical
 * 22 events. Adding them at scale would force a session/speaker
 * fan-out generator too, which is out of scope for Sprint D and
 * would inflate the diff well past review-ability.
 */

import type { Firestore } from "firebase-admin/firestore";

import { Dates, atOffset, CITIES } from "./config";
import { EXPANSION_PARTICIPANT_UIDS, IDS } from "./ids";

// ─── Deterministic PRNG (Mulberry32) ──────────────────────────────────────
// 32-bit state; period 2^32. Sufficient for ~1 900 numbers across the
// generator. Fixed seed = stable output for snapshot stability.

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(0xc0ffee);
const pickInt = (min: number, max: number): number =>
  Math.floor(rng() * (max - min + 1)) + min;
const pick = <T,>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("pick: empty array");
  return arr[Math.floor(rng() * arr.length)]!;
};

// ─── Lookup pools ─────────────────────────────────────────────────────────
//
// Per-org synthetic-event BUDGET — must respect `maxEvents` from
// PLAN_LIMITS once the canonical events in 04-events.ts are added on top.
//
// Canonical event counts per pool org (from 04-events.ts):
//   • orgId            (pro)        — ~8 canonical events  (cap = ∞)
//   • venueOrgId       (starter)    —  0 canonical events  (cap = 10)
//   • enterpriseOrgId  (enterprise) — ~6 canonical events  (cap = ∞)
//   • freeOrgId        (free)       —  3 canonical events  (cap = 3) → SATURATED
//
// The previous weighted-modulo distribution gave free ~8 synth events
// and starter ~24 synth events, both way over their caps. Any test that
// calls `event.create` against a saturated org would then fire
// PlanLimitError. The hard budget below keeps each tier strictly within
// `(maxEvents - canonicalCount)` so the seed is plan-correctness-safe.
//
// Budget total = TARGET_EVENTS so the procedural pass writes the same
// total volume; only the distribution shifts.
const ORG_BUDGET: ReadonlyArray<{
  id: string;
  plan: "free" | "starter" | "pro" | "enterprise";
  budget: number;
}> = [
  { id: IDS.orgId, plan: "pro", budget: 45 }, // pro = ∞, takes the bulk
  { id: IDS.venueOrgId, plan: "starter", budget: 10 }, // starter cap=10, canonical=0 → 10 OK
  { id: IDS.enterpriseOrgId, plan: "enterprise", budget: 25 }, // enterprise = ∞
  { id: IDS.freeOrgId, plan: "free", budget: 0 }, // free cap=3, canonical=3 → SATURATED
];

// Build a flat assignment list so each generated event index maps to a
// concrete org. `flatMap` preserves order so distribution is deterministic.
const ORG_ASSIGNMENT: ReadonlyArray<{
  id: string;
  plan: "free" | "starter" | "pro" | "enterprise";
}> = ORG_BUDGET.flatMap(({ id, plan, budget }) =>
  Array(budget).fill({ id, plan }),
);

// Plan-aware reg-count bounds (mirrors PLAN_LIMITS so the seed never
// exceeds maxParticipantsPerEvent).
const PLAN_REG_BOUNDS: Record<string, [number, number]> = {
  free: [3, 35], // free.maxParticipantsPerEvent = 50
  starter: [12, 160], // starter.maxParticipantsPerEvent = 200
  pro: [40, 480], // pro.maxParticipantsPerEvent = 2000
  enterprise: [80, 800], // enterprise = Infinity, cap at 800 for sanity
};

const CATEGORIES = [
  "conference",
  "workshop",
  "concert",
  "festival",
  "networking",
  "sport",
  "exhibition",
  "ceremony",
  "training",
  "other",
] as const;

const FORMATS = ["in_person", "in_person", "in_person", "hybrid", "online"] as const;

const STATUSES = [
  "published",
  "published",
  "published",
  "published", // 4×published
  "completed",
  "draft",
  "cancelled",
] as const;

const EVENT_TITLE_THEMES = [
  {
    fr: "Forum tech",
    en: "Tech forum",
    wo: "Forum mbóoló",
    cat: "conference",
  },
  {
    fr: "Atelier IA générative",
    en: "Generative AI workshop",
    wo: "Atelier IA",
    cat: "workshop",
  },
  {
    fr: "Concert N'Dombolo",
    en: "N'Dombolo concert",
    wo: "Konseer N'Dombolo",
    cat: "concert",
  },
  {
    fr: "Festival du film africain",
    en: "African film festival",
    wo: "Festival film afrika",
    cat: "festival",
  },
  {
    fr: "Soirée networking startups",
    en: "Startup networking evening",
    wo: "Bànneex starts-up",
    cat: "networking",
  },
  {
    fr: "Tournoi de futsal inter-quartiers",
    en: "Inter-district futsal tournament",
    wo: "Tugaal futsal",
    cat: "sport",
  },
  {
    fr: "Exposition d'art contemporain",
    en: "Contemporary art exhibition",
    wo: "Wone xareem ci tey",
    cat: "exhibition",
  },
  {
    fr: "Cérémonie de remise des diplômes",
    en: "Graduation ceremony",
    wo: "Aksyon ndaw mu njekk",
    cat: "ceremony",
  },
  {
    fr: "Formation en cybersécurité",
    en: "Cybersecurity training",
    wo: "Njàngum cyberresekiriite",
    cat: "training",
  },
  {
    fr: "Hackathon FinTech Dakar",
    en: "Dakar FinTech hackathon",
    wo: "Hackathon FinTech",
    cat: "conference",
  },
  {
    fr: "Salon de l'entrepreneuriat féminin",
    en: "Women's entrepreneurship fair",
    wo: "Salon liggéeyukaay y jigéen",
    cat: "exhibition",
  },
  {
    fr: "Conférence climat & agriculture durable",
    en: "Climate & sustainable agriculture conference",
    wo: "Konfa rénde ak meñ",
    cat: "conference",
  },
] as const;

const FIRST_NAMES = [
  "Aïcha",
  "Awa",
  "Astou",
  "Bineta",
  "Coumba",
  "Fatou",
  "Khadija",
  "Mariama",
  "Ndèye",
  "Ramatoulaye",
  "Sokhna",
  "Adama",
  "Cheikh",
  "Babacar",
  "Demba",
  "Ibrahima",
  "Mamadou",
  "Modou",
  "Moussa",
  "Ousmane",
  "Pape",
  "Saliou",
  "Souleymane",
] as const;

const LAST_NAMES = [
  "Diop",
  "Fall",
  "Gaye",
  "Sall",
  "Mbaye",
  "Faye",
  "Ndiaye",
  "Sow",
  "Ka",
  "Cissé",
  "Diallo",
  "Diouf",
  "Sarr",
  "Niang",
  "Sy",
  "Wade",
  "Kane",
  "Touré",
] as const;

const CITY_KEYS = Object.keys(CITIES);

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * `draft` and `cancelled` events have no participants — the reg writer
 * skips them. Use this guard wherever a count denorm is computed so
 * dashboards don't show phantom seats.
 */
function hasRegistrations(e: { status: GeneratedEvent["status"] }): boolean {
  return e.status === "published" || e.status === "completed";
}

/**
 * Future-dated synthetic events (start in +1..+180d) need a sane
 * `createdAt` so they still surface in `where("createdAt", "<=", now)`
 * queries (audit log, "recently created" rails). Clamp to the smaller
 * of `Dates.now` and `e.startDate`.
 */
function clampToPast(iso: string): string {
  return iso < Dates.now ? iso : Dates.now;
}

// ─── Generators ───────────────────────────────────────────────────────────

// Total synthetic event volume. Must equal `sum(ORG_BUDGET.budget)` so
// each generated index maps 1:1 onto a budget slot without modulo wrap.
const TARGET_EVENTS = 80;

interface GeneratedEvent {
  id: string;
  organizationId: string;
  organizationPlan: "free" | "starter" | "pro" | "enterprise";
  title: string;
  titleEn: string;
  titleWo: string;
  slug: string;
  description: string;
  descriptionEn: string;
  descriptionWo: string;
  category: (typeof CATEGORIES)[number];
  format: (typeof FORMATS)[number];
  status: (typeof STATUSES)[number];
  startDate: string;
  endDate: string;
  cityKey: string;
  registeredCount: number;
  ticketTypeId: string;
}

function generateEvent(index: number): GeneratedEvent {
  // Per-tier budget assignment (see ORG_BUDGET above for cap rationale).
  // index 0..ORG_ASSIGNMENT.length-1 is dense; modulo wraps for safety
  // when TARGET_EVENTS > sum(budgets).
  const org = ORG_ASSIGNMENT[index % ORG_ASSIGNMENT.length]!;

  const theme = pick(EVENT_TITLE_THEMES);
  const cityKey = pick(CITY_KEYS);
  const city = CITIES[cityKey]!;
  const format = pick(FORMATS);
  const status = pick(STATUSES);
  const cat = (theme.cat as (typeof CATEGORIES)[number]) ?? pick(CATEGORIES);

  // Date range: spread over ~9 months (-90d .. +180d).
  const startOffsetDays = pickInt(-90, 180);
  const durationHours = pickInt(2, 72);
  const startMs = startOffsetDays * 86_400_000;
  const endMs = startMs + durationHours * 3_600_000;
  const startDate = atOffset(startMs);
  const endDate = atOffset(endMs);

  // Reg count proportional to plan tier.
  const [minRegs, maxRegs] = PLAN_REG_BOUNDS[org.plan]!;
  const registeredCount = pickInt(minRegs, maxRegs);

  const id = `event-syn-${String(index + 1).padStart(3, "0")}`;
  const editionLabel = String(index + 1).padStart(3, "0");
  const title = `${theme.fr} #${editionLabel} (${city.name})`;
  const titleEn = `${theme.en} #${editionLabel} (${city.name})`;
  const titleWo = `${theme.wo} #${editionLabel} (${city.name})`;
  const slug = `${theme.fr.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${editionLabel}-${cityKey.toLowerCase()}`;
  const description =
    `Édition #${editionLabel} de notre série « ${theme.fr} » à ${city.name}. ` +
    `Format ${format === "in_person" ? "présentiel" : format === "online" ? "en ligne" : "hybride"}, ` +
    `événement ${cat}.`;
  const descriptionEn =
    `Edition #${editionLabel} of our « ${theme.en} » series in ${city.name}. ` +
    `${format === "in_person" ? "In-person" : format === "online" ? "Online" : "Hybrid"} format, ` +
    `${cat} event.`;
  const descriptionWo =
    `Edisyoŋ #${editionLabel} ci ${city.name}. Aksyon ${cat}, format ${format}.`;

  return {
    id,
    organizationId: org.id,
    organizationPlan: org.plan,
    title,
    titleEn,
    titleWo,
    slug,
    description,
    descriptionEn,
    descriptionWo,
    category: cat,
    format,
    status,
    startDate,
    endDate,
    cityKey,
    registeredCount,
    ticketTypeId: `ticket-syn-${editionLabel}-standard`,
  };
}

// ─── Writers ──────────────────────────────────────────────────────────────

async function writeSyntheticEvents(
  db: Firestore,
  events: GeneratedEvent[],
): Promise<number> {
  // Firestore batches cap at 500 ops; 80 events fits in one batch
  // but the helper keeps the splitting logic correct in case the
  // target grows.
  const CHUNK = 400;
  let total = 0;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const e of chunk) {
      const city = CITIES[e.cityKey]!;
      const doc = {
        id: e.id,
        organizationId: e.organizationId,
        title: e.title,
        // Localised mirrors — surfaced by the client locale switcher.
        titleEn: e.titleEn,
        titleWo: e.titleWo,
        slug: e.slug,
        description: e.description,
        descriptionEn: e.descriptionEn,
        descriptionWo: e.descriptionWo,
        shortDescription: null,
        coverImageURL: null,
        bannerImageURL: null,
        category: e.category,
        // M2 fix — namespace the marker so search-facet UIs that strip
        // `__seed:` prefixes don't surface "synthetic" as a discoverable
        // tag chip in the participant app. Category + region remain
        // user-facing.
        tags: ["__seed:synthetic", e.category, city.region ?? city.country],
        format: e.format,
        status: e.status,
        location: {
          name: `${city.name} — Salle synthétique #${e.id.slice(-3)}`,
          address: `${pickInt(1, 99)} avenue de l'Indépendance`,
          city: city.name,
          country: city.countryCode,
          coordinates: city.coordinates,
        },
        startDate: e.startDate,
        endDate: e.endDate,
        timezone: city.timezone,
        // M1 — draft and cancelled events MUST NOT carry a non-zero
        // registeredCount denorm. The reg-writer below skips them, so a
        // non-zero counter would overcount in every dashboard tile.
        ticketTypes: [
          {
            id: e.ticketTypeId,
            name: "Standard",
            description: "Billet standard (généré)",
            price: 0,
            currency: "XOF",
            totalQuantity: hasRegistrations(e) ? e.registeredCount + 50 : 50,
            soldCount: hasRegistrations(e) ? e.registeredCount : 0,
            accessZoneIds: [],
            isVisible: true,
          },
        ],
        accessZones: [],
        maxAttendees: hasRegistrations(e) ? e.registeredCount + 50 : 50,
        registeredCount: hasRegistrations(e) ? e.registeredCount : 0,
        checkedInCount: 0,
        isPublic: e.status === "published",
        isFeatured: false,
        venueId: null,
        venueName: null,
        requiresApproval: false,
        scanPolicy: "single",
        templateId: null,
        createdBy:
          e.organizationPlan === "free" ? IDS.freeOrganizer : IDS.organizer,
        updatedBy:
          e.organizationPlan === "free" ? IDS.freeOrganizer : IDS.organizer,
        // M3 — clamp createdAt/updatedAt to a past date so future events
        // still surface in `where("createdAt", "<=", now)` queries
        // (audit log, "recently created" rails). Using `e.startDate`
        // (which can be up to +180d) silently dropped half the dataset.
        createdAt: clampToPast(e.startDate),
        updatedAt: clampToPast(e.startDate),
        publishedAt: e.status === "published" ? clampToPast(e.startDate) : null,
        archivedAt: null,
        qrKid: null,
        qrKidHistory: [],
        isRecurringParent: false,
        parentEventId: null,
        occurrenceIndex: null,
      };
      batch.set(db.collection("events").doc(e.id), doc);
      total += 1;
    }
    await batch.commit();
  }
  return total;
}

async function writeSyntheticRegistrations(
  db: Firestore,
  events: GeneratedEvent[],
): Promise<number> {
  // For published / completed events only — drafts and cancelled
  // events should not have registrations.
  const eligible = events.filter(
    (e) => e.status === "published" || e.status === "completed",
  );

  let total = 0;
  let participantCounter = 0;

  // Firestore batch cap is 500. One reg = one write.
  const CHUNK = 400;
  let buffer: { id: string; data: Record<string, unknown> }[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = db.batch();
    for (const { id, data } of buffer) {
      batch.set(db.collection("registrations").doc(id), data);
    }
    await batch.commit();
    total += buffer.length;
    buffer = [];
  };

  for (const e of eligible) {
    for (let i = 0; i < e.registeredCount; i++) {
      participantCounter += 1;
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const ord = String(participantCounter).padStart(5, "0");
      // H1 fix — round-robin REAL expansion participants (27 of them)
      // rather than fabricating `participant-syn-NNNNN` UIDs that have
      // no Auth user / no `users/` profile. The previous approach left
      // ~1 800 dangling refs; every UI that joins registration → user
      // (organizer attendee list, lead exports, audit) rendered blanks.
      // Round-robin gives each real participant ~70 regs across the
      // procedural pool, which is realistic for a power-user demo.
      const synUid =
        EXPANSION_PARTICIPANT_UIDS[participantCounter % EXPANSION_PARTICIPANT_UIDS.length]!;
      const regId = `reg-syn-${ord}`;
      // 1 in 6 of the past events have a check-in stamped — exercises
      // the dashboard's "checked in" filter without polluting future
      // events.
      const isPastEvent = new Date(e.startDate) < new Date(Dates.now);
      const checkedIn = isPastEvent && pickInt(1, 6) === 1;
      const data = {
        id: regId,
        eventId: e.id,
        userId: synUid,
        ticketTypeId: e.ticketTypeId,
        ticketTypeName: "Standard",
        participantName: `${first} ${last}`,
        participantEmail: `${first.toLowerCase()}.${last.toLowerCase()}.${ord}@example.com`,
        status: checkedIn ? "checked_in" : "confirmed",
        qrCodeValue: `${regId}:${e.id}:${synUid}:demo:demo:demo-syn-${ord}`,
        checkedInAt: checkedIn ? e.startDate : null,
        checkedInBy: checkedIn ? IDS.staffUser : null,
        notes: null,
        createdAt: e.startDate,
        updatedAt: checkedIn ? e.startDate : e.startDate,
        eventTitle: e.title,
        eventSlug: e.slug,
        eventStartDate: e.startDate,
        eventEndDate: e.endDate,
        accessZoneId: null,
        promotedFromWaitlistAt: null,
      };
      buffer.push({ id: regId, data });
      if (buffer.length >= CHUNK) await flush();
    }
  }
  await flush();
  return total;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export interface RichDatasetCounts {
  events: number;
  registrations: number;
}

export async function seedRichDataset(db: Firestore): Promise<RichDatasetCounts> {
  const events = Array.from({ length: TARGET_EVENTS }, (_, i) => generateEvent(i));
  const eventCount = await writeSyntheticEvents(db, events);
  const regCount = await writeSyntheticRegistrations(db, events);
  return { events: eventCount, registrations: regCount };
}
