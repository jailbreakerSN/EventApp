/**
 * Canonical event i18n backfill — EN + WO mirrors of the 22 hand-crafted
 * events in `04-events.ts`.
 *
 * Why a sibling file (and not inline in `04-events.ts`)?
 * ────────────────────────────────────────────────────────
 * • The legacy event records are byte-for-byte locked (anchor for inline
 *   fixtures in `seed-emulators.ts`). Inlining 22 × 5 i18n keys would add
 *   ~200 lines of noise and risk an editor hunting through to mutate a
 *   protected field by mistake.
 * • Translations are a separate editorial concern from the canonical event
 *   data — keeping them in a side-file makes proofread diffs trivial.
 *
 * Wolof translation policy
 * ────────────────────────
 * Senegalese Wolof in 2026 is heavily code-switched — "conference",
 * "festival", "marathon", "atelier", "concert" are loaned verbatim. We
 * follow that convention rather than coining contrived pure-Wolof
 * neologisms that no native speaker would actually use in conversation.
 * Pure-Wolof equivalents are reserved for high-frequency UX words
 * ("ndaje" = meetup, "njàngal" = formation, "bés" = day, "guddi" = night).
 *
 * Coverage
 * ────────
 * Each canonical event ships with:
 *   • `titleEn` / `titleWo`             — header surface (cards, lists)
 *   • `shortDescriptionEn` / `shortDescriptionWo` — list snippet
 *   • `descriptionEn`                    — long-form English paraphrase
 *
 * Long-form Wolof prose is intentionally NOT included — Wolof is primarily
 * an oral language and forcing literary prose would degrade authenticity.
 * The discoverable surface (title + shortDescription) is what users
 * actually read in WO; long descriptions stay FR (default) or EN (opt-in).
 */

export type CanonicalEventI18n = {
  titleEn: string;
  titleWo: string;
  shortDescriptionEn: string;
  shortDescriptionWo: string;
  descriptionEn: string;
};

export const CANONICAL_EVENT_I18N: Record<string, CanonicalEventI18n> = {
  // ─── Legacy events ──────────────────────────────────────────────────────
  "event-001": {
    titleEn: "Dakar Tech Summit 2026",
    titleWo: "Dakar Tech Summit 2026",
    shortDescriptionEn: "West Africa's flagship tech gathering",
    shortDescriptionWo: "Ndaje tech bu mag bi ci Dakar",
    descriptionEn:
      "West Africa's largest tech event. Two days of talks, workshops, and networking with the continent's top tech talent.",
  },
  "event-002": {
    titleEn: "Flutter & Firebase Workshop",
    titleWo: "Atelier Flutter & Firebase",
    shortDescriptionEn: "Hands-on Flutter + Firebase workshop",
    shortDescriptionWo: "Atelier Flutter ak Firebase",
    descriptionEn:
      "A 4-hour hands-on workshop to build a mobile app with Flutter and Firebase. Bring your laptop!",
  },
  "event-003": {
    titleEn: "Dakar Developers Meetup #12",
    titleWo: "Ndaje développeur yi ci Dakar #12",
    shortDescriptionEn: "Monthly Dakar dev meetup",
    shortDescriptionWo: "Ndajem dev bu weer wu nekk ci Dakar",
    descriptionEn:
      "Monthly meetup for Dakar developers. Lightning talks and networking.",
  },
  "event-004": {
    titleEn: "Generative AI Masterclass",
    titleWo: "Masterclass IA Générative",
    shortDescriptionEn: "Master generative AI in one day",
    shortDescriptionWo: "Jàng IA Générative ci benn bés",
    descriptionEn:
      "An intensive day to master generative AI tools — ChatGPT, Claude, Midjourney — and their business applications across Africa.",
  },

  // ─── Expansion events (event-005 → event-022) ──────────────────────────
  "event-005": {
    titleEn: "Saly Hip-Hop Festival",
    titleWo: "Festival Hip-Hop ci Saly",
    shortDescriptionEn: "Pan-African hip-hop festival on Saly beach",
    shortDescriptionWo: "Festival hip-hop ci tefes bu Saly",
    descriptionEn:
      "Three days of francophone hip-hop on Saly beach. Pan-African line-up — Senegal, Côte d'Ivoire, Mali, Togo — with beatmaking masterclass and open mic.",
  },
  "event-006": {
    titleEn: "Dakar Marathon 2026",
    titleWo: "Marathon bu Dakar 2026",
    shortDescriptionEn: "Dakar's annual 42 km marathon",
    shortDescriptionWo: "Marathon bu Dakar — 42 km",
    descriptionEn:
      "Dakar's annual marathon — 42.195 km through the Senegalese capital. Certified course, 5,000 expected runners, route Almadies → Corniche → Monument of the Renaissance.",
  },
  "event-007": {
    titleEn: "Dakar Developers Meetup #13 (LIVE)",
    titleWo: "Ndaje dev ci Dakar #13 (lu jot)",
    shortDescriptionEn: "Monthly dev meetup — live",
    shortDescriptionWo: "Ndajem dev — bii ñu nekkee",
    descriptionEn:
      "13th edition of the monthly Dakar developers meetup. On the agenda: Flutter 4.0, AI in production lessons learned, and open networking.",
  },
  "event-008": {
    titleEn: "Saint-Louis Digital Design Workshop (LIVE)",
    titleWo: "Atelier design digital ci Saint-Louis (lu jot)",
    shortDescriptionEn: "Digital design workshop — live",
    shortDescriptionWo: "Atelier design ci Saint-Louis",
    descriptionEn:
      "Hands-on digital interface design workshop for NGOs and SMEs in northern Senegal. Figma, rapid prototyping, WCAG accessibility — happening live at Institut Français.",
  },
  "event-009": {
    titleEn: "AI Training for Executive Leaders",
    titleWo: "Njàngal IA ngir njiit yi",
    shortDescriptionEn: "Online AI training — 2 days",
    shortDescriptionWo: "Njàngal IA — ñaari bés ci internet",
    descriptionEn:
      "2-day online training on generative AI for management. Pan-African use cases, prompt engineering studio, Claude + ChatGPT enterprise integration. 100% online — accessible from Bamako, Dakar, Abidjan, Lomé.",
  },
  "event-010": {
    titleEn: "West African Fintech Conference",
    titleWo: "Conférence Fintech ci Afrik bu Sowwu",
    shortDescriptionEn: "Pan-African fintech — hybrid (Thiès + stream)",
    shortDescriptionWo: "Fintech — Thiès ak ci internet",
    descriptionEn:
      "Annual gathering of francophone West African fintech players — Wave, Orange Money, Free Money, and new entrants. Live at Thiès + streaming for Dakar / Abidjan / Bamako attendees.",
  },
  "event-011": {
    titleEn: "Youssou N'Dour Concert — Grand Bal de Dakar",
    titleWo: "Concert Youssou N'Dour — Grand Bal bu Dakar",
    shortDescriptionEn: "Youssou N'Dour live — Monument of the Renaissance",
    shortDescriptionWo: "Youssou N'Dour — Monument bu Renaissance",
    descriptionEn:
      "The king of mbalax in concert at the Monument of the Renaissance esplanade. Opening act by Baaba Maal. 15,000-seat capacity — first official online ticketing.",
  },
  "event-012": {
    titleEn: "Web Summit Thiès — 2026 Edition",
    titleWo: "Web Summit Thiès — 2026",
    shortDescriptionEn: "Regional tech Web Summit in Thiès",
    shortDescriptionWo: "Web Summit ci Thiès",
    descriptionEn:
      "Regional tech conference organized by Teranga Events in Thiès. Three tracks: startup, dev, product. 40 speakers, 600 attendees, partner exhibition.",
  },
  "event-013": {
    titleEn: "Saint-Louis Jazz Festival",
    titleWo: "Festival Jazz bu Saint-Louis",
    shortDescriptionEn: "Saint-Louis Jazz Festival — 34th edition",
    shortDescriptionWo: "Festival Jazz — 34i edition",
    descriptionEn:
      "34th edition of the Saint-Louis International Jazz Festival. 4 days, 3 stages, artists from Senegal, Mali, USA, France. Full programme on the official site.",
  },
  "event-014": {
    titleEn: "Advanced Flutter Training — Ziguinchor",
    titleWo: "Njàngal Flutter bu mag — Ziguinchor",
    shortDescriptionEn: "Advanced Flutter training — hybrid Ziguinchor",
    shortDescriptionWo: "Njàngal Flutter ci Ziguinchor",
    descriptionEn:
      "3-day intensive Flutter 4.0 training for Casamance mobile developers. Live at Alliance Franco-Sénégalaise + hybrid session for Dakar / Abidjan. Capstone project included.",
  },
  "event-015": {
    titleEn: "Dakar Mobile Meetup — Flutter vs React Native",
    titleWo: "Ndajem mobile ci Dakar — Flutter ak React Native",
    shortDescriptionEn: "Flutter vs React Native battle in Dakar",
    shortDescriptionWo: "Flutter ak React Native — ndaje",
    descriptionEn:
      "Open debate between Dakar's Flutter and React Native communities. Lightning talks, live demos, audience vote. Beer and pizzas on the house.",
  },
  "event-016": {
    titleEn: "Thiès Regional Marathon",
    titleWo: "Marathon bu Thiès",
    shortDescriptionEn: "Thiès regional marathon — first edition",
    shortDescriptionWo: "Marathon bu Thiès — 1i edition",
    descriptionEn:
      "First edition of the Thiès regional marathon — 42 km + 21 km half + 10 km people's race. Start at Stade Lat Dior, loop through the Thiès plateau.",
  },
  "event-017": {
    titleEn: "AfricaTech Online Conference 2026",
    titleWo: "AfricaTech 2026 — ci internet",
    shortDescriptionEn: "AfricaTech 2026 — pan-African online conference",
    shortDescriptionWo: "AfricaTech — Afrik bépp ci internet",
    descriptionEn:
      "100% online tech conference covering 12 francophone African countries. 50 speakers, 8 tracks, demo studio. Live FR / EN / Portuguese translation.",
  },
  "event-018": {
    titleEn: "Dakar UX Exhibition 2026",
    titleWo: "Exposition UX ci Dakar 2026",
    shortDescriptionEn: "Francophone UX/UI expo in Dakar",
    shortDescriptionWo: "Expo UX/UI ci Dakar",
    descriptionEn:
      "Showcase of the best UX/UI portfolios from francophone Africa. 40 designers, guided tour, jury and audience awards. Opening reception on day one.",
  },
  "event-019": {
    titleEn: "Baaba Maal Concert — Saly Night",
    titleWo: "Concert Baaba Maal — Guddi bu Saly",
    shortDescriptionEn: "Baaba Maal acoustic in Saly",
    shortDescriptionWo: "Baaba Maal ci Saly",
    descriptionEn:
      "Acoustic evening with Baaba Maal on Saly beach — Yela, Pulaar, classics repertoire. Seaside stage, optional Senegalese dinner.",
  },
  "event-020": {
    titleEn: "Applied AI Workshop — Abidjan",
    titleWo: "Atelier IA — Abidjan",
    shortDescriptionEn: "Applied AI workshop in Abidjan (hybrid)",
    shortDescriptionWo: "Atelier IA ci Abidjan",
    descriptionEn:
      "2-day intensive workshop on AI applied to marketing and communications — Côte d'Ivoire. Live at Sofitel Abidjan + online session for Dakar and Bamako.",
  },
  "event-021": {
    titleEn: "Thiès Student Hackathon 2026 [DRAFT]",
    titleWo: "Hackathon ñu jàng — Thiès 2026 [tegtal]",
    shortDescriptionEn: "48 h student hackathon, in preparation",
    shortDescriptionWo: "Hackathon — 48 waxtu, ñu ngiy yokk",
    descriptionEn:
      "Draft — editor: Oumar Ba. 48-hour hackathon for computer science students at the University of Thiès. Budget, sponsors, and programme to be confirmed.",
  },
  "event-022": {
    titleEn: "Dakar AI Meetup — March 2026 (cancelled)",
    titleWo: "Ndajem IA ci Dakar — Mars 2026 (dañu ko bayyi)",
    shortDescriptionEn: "Dakar AI meetup — March edition cancelled",
    shortDescriptionWo: "Ndajem IA — dañu ko bayyi",
    descriptionEn:
      "Cancelled — last-minute venue issue. The next edition is rescheduled for April; the link will be shared on the Startup Dakar mailing list.",
  },
};
