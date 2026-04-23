/**
 * Seed "social" fixtures — the slice of the seed that is about user-to-user
 * signal rather than operator data: feed posts + comments, conversations +
 * messages, notifications, notification preferences, broadcasts, the
 * check-in feed, the audit log, and subscription documents.
 *
 * This module extracts what used to be inline sections 13-20 of
 * `seed-emulators.ts`. Legacy fixtures are preserved BYTE-FOR-BYTE so the
 * participant feed + messaging + notifications surfaces keep rendering the
 * same cards / threads / badges they did before the modular split.
 *
 * Expansion social content (feed posts on LIVE / past events, welcome
 * notifications for new participants, audit entries on expansion events)
 * lands in the follow-up commit on this branch as pure additions to the
 * named arrays below.
 */

import type { Firestore } from "firebase-admin/firestore";

import { PLAN_DISPLAY, type OrganizationPlan } from "@teranga/shared-types";

import { Dates } from "./config";
import { IDS } from "./ids";
import { EXPANSION_PARTICIPANTS } from "./02-users";
import { EXPANSION_EVENT_DENORM } from "./04-events";

const {
  now,
  twoHoursAgo,
  oneHourAgo,
  yesterday,
  twoDaysAgo,
  oneWeekAgo,
  twoWeeksAgo,
  oneMonthAgo,
  fortyFiveDaysAgo,
} = Dates;

// ─── Feed posts + comments ────────────────────────────────────────────────

type SeedFeedPost = {
  id: string;
  eventId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  likeCount: number;
  likedByIds: string[];
  commentCount: number;
  isPinned: boolean;
  isAnnouncement: boolean;
  createdAt: string;
  updatedAt: string;
};

const LEGACY_FEED_POSTS: SeedFeedPost[] = [
  {
    id: IDS.post1,
    eventId: IDS.conference,
    authorId: IDS.organizer,
    authorName: "Moussa Diop",
    authorRole: "organizer",
    content:
      "🎉 Bienvenue au Dakar Tech Summit 2026 ! Le programme est en ligne. N'oubliez pas de réserver vos places pour les ateliers. #DTS2026",
    likeCount: 3,
    likedByIds: [IDS.participant1, IDS.participant2, IDS.speakerUser],
    commentCount: 1,
    isPinned: true,
    isAnnouncement: true,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: IDS.post2,
    eventId: IDS.conference,
    authorId: IDS.speakerUser,
    authorName: "Ibrahima Gueye",
    authorRole: "speaker",
    content:
      "Hâte de vous retrouver pour la keynote ! Je prépare une démo live de Flutter + Firebase qui va vous surprendre 🚀",
    likeCount: 5,
    likedByIds: [
      IDS.participant1,
      IDS.participant2,
      IDS.organizer,
      IDS.coOrganizer,
      IDS.sponsorUser,
    ],
    commentCount: 1,
    isPinned: false,
    isAnnouncement: false,
    createdAt: yesterday,
    updatedAt: yesterday,
  },
  {
    id: IDS.post3,
    eventId: IDS.conference,
    authorId: IDS.participant1,
    authorName: "Aminata Fall",
    authorRole: "participant",
    content: "Quelqu'un pour partager un taxi depuis Plateau jusqu'au CICAD le jour J ? 🚕",
    likeCount: 1,
    likedByIds: [IDS.participant2],
    commentCount: 0,
    isPinned: false,
    isAnnouncement: false,
    createdAt: oneHourAgo,
    updatedAt: oneHourAgo,
  },
];

// 7 feed posts across the expansion — pinned organiser announcements on
// upcoming events, live progress updates on LIVE events, and recap posts on
// past events. Authors reference the real org owners defined in
// 02-users.ts so the avatars + roles render correctly.
const EXPANSION_FEED_POSTS: SeedFeedPost[] = [
  // event-005 — recap of past festival Saly
  {
    id: "post-e05-01",
    eventId: "event-005",
    authorId: IDS.enterpriseOrganizer,
    authorName: "Mame Diarra Seck",
    authorRole: "organizer",
    content:
      "Merci à vous tous pour cette édition 2026 du Festival Hip-Hop de Saly ! 🎤 Photos officielles disponibles ce vendredi. On se retrouve l'année prochaine 🙌",
    likeCount: 124,
    likedByIds: [
      EXPANSION_PARTICIPANTS[10].uid, // Yacine
      EXPANSION_PARTICIPANTS[11].uid, // Ousseynou
      EXPANSION_PARTICIPANTS[0].uid, // Mariama
    ],
    commentCount: 0,
    isPinned: false,
    isAnnouncement: false,
    createdAt: oneMonthAgo,
    updatedAt: oneMonthAgo,
  },
  // event-007 — LIVE meetup dev Dakar
  {
    id: "post-e07-01",
    eventId: "event-007",
    authorId: IDS.freeOrganizer,
    authorName: "Djibril Mbaye",
    authorRole: "organizer",
    content:
      "🎤 On démarre ! Première lightning talk dans 5 minutes chez Jokkolabs. Le stream sera actif pour celles et ceux qui ne sont pas sur place.",
    likeCount: 18,
    likedByIds: [
      EXPANSION_PARTICIPANTS[3].uid,
      EXPANSION_PARTICIPANTS[4].uid,
      EXPANSION_PARTICIPANTS[7].uid,
    ],
    commentCount: 0,
    isPinned: true,
    isAnnouncement: true,
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
  },
  // event-008 — LIVE workshop Saint-Louis
  {
    id: "post-e08-01",
    eventId: "event-008",
    authorId: IDS.starterOrganizer,
    authorName: "Oumar Ba",
    authorRole: "organizer",
    content:
      "Session prototypage Figma démarre dans 15 min 👨‍💻 Merci à l'Institut Français pour l'accueil chaleureux.",
    likeCount: 9,
    likedByIds: [EXPANSION_PARTICIPANTS[16].uid, EXPANSION_PARTICIPANTS[17].uid],
    commentCount: 0,
    isPinned: true,
    isAnnouncement: true,
    createdAt: oneHourAgo,
    updatedAt: oneHourAgo,
  },
  // event-010 — upcoming Fintech Thiès (announcement)
  {
    id: "post-e10-01",
    eventId: "event-010",
    authorId: IDS.starterOrganizer,
    authorName: "Oumar Ba",
    authorRole: "organizer",
    content:
      "📣 Programme complet de la Conférence Fintech Ouest-Africaine publié ! 3 keynotes, 6 panels et un studio de démos. On vous attend à Thiès le 29 et en streaming 🌍",
    likeCount: 47,
    likedByIds: [
      EXPANSION_PARTICIPANTS[13].uid,
      EXPANSION_PARTICIPANTS[14].uid,
      EXPANSION_PARTICIPANTS[15].uid,
    ],
    commentCount: 0,
    isPinned: true,
    isAnnouncement: true,
    createdAt: twoWeeksAgo,
    updatedAt: twoWeeksAgo,
  },
  // event-011 — upcoming concert Youssou N'Dour (announcement)
  {
    id: "post-e11-01",
    eventId: "event-011",
    authorId: IDS.enterpriseOrganizer,
    authorName: "Mame Diarra Seck",
    authorRole: "organizer",
    content:
      "🎶 Annonce officielle : Baaba Maal assurera la première partie du Grand Bal de Dakar ! Les pass Carré Or partent vite — sécurisez le vôtre 🔥",
    likeCount: 312,
    likedByIds: [
      EXPANSION_PARTICIPANTS[12].uid,
      EXPANSION_PARTICIPANTS[8].uid,
      EXPANSION_PARTICIPANTS[9].uid,
      EXPANSION_PARTICIPANTS[2].uid,
    ],
    commentCount: 0,
    isPinned: true,
    isAnnouncement: true,
    createdAt: oneWeekAgo,
    updatedAt: oneWeekAgo,
  },
  // event-014 — upcoming Flutter Ziguinchor (organiser note)
  {
    id: "post-e14-01",
    eventId: "event-014",
    authorId: IDS.starterOrganizer,
    authorName: "Oumar Ba",
    authorRole: "organizer",
    content:
      "Inscriptions ouvertes pour la formation Flutter avancée à Ziguinchor 📱 Places limitées à 25 sur place + nombre illimité en ligne. Hébergement organisable sur demande.",
    likeCount: 15,
    likedByIds: [
      EXPANSION_PARTICIPANTS[19].uid,
      EXPANSION_PARTICIPANTS[20].uid,
      EXPANSION_PARTICIPANTS[26].uid,
    ],
    commentCount: 0,
    isPinned: false,
    isAnnouncement: true,
    createdAt: twoWeeksAgo,
    updatedAt: twoWeeksAgo,
  },
  // event-017 — upcoming AfricaTech Online (participant post)
  {
    id: "post-e17-01",
    eventId: "event-017",
    authorId: EXPANSION_PARTICIPANTS[21].uid, // Kouamé (Abidjan)
    authorName: EXPANSION_PARTICIPANTS[21].displayName,
    authorRole: "participant",
    content:
      "Qui sera présent au studio de démos de l'AfricaTech 2026 ? On prépare une démo côté Abidjan avec quelques collègues 👋",
    likeCount: 7,
    likedByIds: [
      EXPANSION_PARTICIPANTS[22].uid,
      EXPANSION_PARTICIPANTS[23].uid,
      EXPANSION_PARTICIPANTS[24].uid,
      EXPANSION_PARTICIPANTS[26].uid,
    ],
    commentCount: 0,
    isPinned: false,
    isAnnouncement: false,
    createdAt: twoDaysAgo,
    updatedAt: twoDaysAgo,
  },
];

type SeedFeedComment = {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
};

const LEGACY_FEED_COMMENTS: SeedFeedComment[] = [
  {
    id: IDS.comment1,
    postId: IDS.post1,
    authorId: IDS.participant1,
    authorName: "Aminata Fall",
    content: "Trop hâte ! Le programme est super cette année 🔥",
    createdAt: yesterday,
  },
  {
    id: IDS.comment2,
    postId: IDS.post2,
    authorId: IDS.participant2,
    authorName: "Ousmane Ndiaye",
    content: "Flutter + Firebase = combo gagnant ! Vivement la démo",
    createdAt: yesterday,
  },
];

const EXPANSION_FEED_COMMENTS: SeedFeedComment[] = [];

async function writeFeedPosts(db: Firestore): Promise<number> {
  const all = [...LEGACY_FEED_POSTS, ...EXPANSION_FEED_POSTS];
  await Promise.all(
    all.map((p) =>
      db
        .collection("feedPosts")
        .doc(p.id)
        .set({
          ...p,
          authorPhotoURL: null,
          mediaURLs: [],
          deletedAt: null,
        }),
    ),
  );
  return all.length;
}

async function writeFeedComments(db: Firestore): Promise<number> {
  const all = [...LEGACY_FEED_COMMENTS, ...EXPANSION_FEED_COMMENTS];
  await Promise.all(
    all.map((c) =>
      db
        .collection("feedComments")
        .doc(c.id)
        .set({ ...c, deletedAt: null }),
    ),
  );
  return all.length;
}

// ─── Conversations + messages ─────────────────────────────────────────────

async function writeConversationsAndMessages(db: Firestore): Promise<{
  conversations: number;
  messages: number;
}> {
  const conversations = [
    {
      id: IDS.conv1,
      participantIds: [IDS.participant1, IDS.speakerUser],
      eventId: IDS.conference,
      lastMessage: "Avec plaisir ! Passez au stand après la keynote",
      lastMessageAt: oneHourAgo,
      unreadCounts: { [IDS.participant1]: 1, [IDS.speakerUser]: 0 },
      createdAt: yesterday,
      updatedAt: oneHourAgo,
    },
    {
      id: IDS.conv2,
      participantIds: [IDS.participant1, IDS.participant2],
      eventId: IDS.conference,
      lastMessage: "On se retrouve à l'entrée du CICAD ?",
      lastMessageAt: oneHourAgo,
      unreadCounts: { [IDS.participant1]: 0, [IDS.participant2]: 1 },
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
    },
  ];

  const messages = [
    {
      id: "msg-001",
      conversationId: IDS.conv1,
      senderId: IDS.participant1,
      content:
        "Bonjour Ibrahima ! J'ai adoré votre talk au meetup #11. Est-ce qu'on pourrait discuter de Firebase offline ?",
      isRead: true,
      readAt: yesterday,
      createdAt: yesterday,
      updatedAt: yesterday,
    },
    {
      id: "msg-002",
      conversationId: IDS.conv1,
      senderId: IDS.speakerUser,
      content: "Avec plaisir ! Passez au stand après la keynote",
      isRead: false,
      readAt: null,
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
    },
    {
      id: "msg-003",
      conversationId: IDS.conv2,
      senderId: IDS.participant1,
      content: "On se retrouve à l'entrée du CICAD ?",
      isRead: false,
      readAt: null,
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
    },
  ];

  await Promise.all([
    ...conversations.map((c) => db.collection("conversations").doc(c.id).set(c)),
    ...messages.map((m) =>
      db
        .collection("messages")
        .doc(m.id)
        .set({ ...m, type: "text", mediaURL: null, deletedAt: null }),
    ),
  ]);
  return { conversations: conversations.length, messages: messages.length };
}

// ─── Notifications + preferences ──────────────────────────────────────────

type SeedNotification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

const LEGACY_NOTIFICATIONS: SeedNotification[] = [
  {
    id: "notif-001",
    userId: IDS.participant1,
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Votre inscription au Dakar Tech Summit 2026 est confirmée. Votre badge est prêt !",
    data: { eventId: IDS.conference, registrationId: IDS.reg1 },
    isRead: true,
    readAt: yesterday,
    createdAt: yesterday,
  },
  {
    id: "notif-002",
    userId: IDS.participant2,
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Votre inscription au Dakar Tech Summit 2026 est confirmée.",
    data: { eventId: IDS.conference, registrationId: IDS.reg2 },
    isRead: false,
    readAt: null,
    createdAt: yesterday,
  },
  {
    id: "notif-003",
    userId: IDS.participant1,
    type: "check_in_success",
    title: "Check-in réussi",
    body: "Vous êtes enregistré(e) au Dakar Tech Summit. Bon événement !",
    data: { eventId: IDS.conference },
    isRead: true,
    readAt: oneHourAgo,
    createdAt: oneHourAgo,
  },
  {
    id: "notif-004",
    userId: IDS.participant1,
    type: "new_message",
    title: "Nouveau message",
    body: "Ibrahima Gueye vous a envoyé un message",
    data: { conversationId: IDS.conv1 },
    isRead: false,
    readAt: null,
    createdAt: oneHourAgo,
  },
  {
    id: "notif-005",
    userId: IDS.participant2,
    type: "new_announcement",
    title: "Nouvelle annonce",
    body: "Moussa Diop a publié une annonce pour Dakar Tech Summit 2026",
    data: { eventId: IDS.conference, postId: IDS.post1 },
    isRead: false,
    readAt: null,
    createdAt: yesterday,
  },
];

// 10 notifications for expansion participants — a welcome-style
// registration_confirmed per event, plus a handful of check-in successes on
// the past + LIVE events so the notification bell is never empty for an
// expansion user logging in.
const EXPANSION_NOTIFICATIONS: SeedNotification[] = [
  // event-005 past — Yacine checked in (got the "merci d'être venu" push)
  {
    id: "notif-e05-01",
    userId: EXPANSION_PARTICIPANTS[10].uid, // Yacine
    type: "check_in_success",
    title: "Check-in réussi",
    body: "Merci d'avoir assisté au Festival Hip-Hop de Saly. Photos bientôt disponibles !",
    data: { eventId: "event-005" },
    isRead: true,
    readAt: oneMonthAgo,
    createdAt: fortyFiveDaysAgo,
  },
  // event-007 LIVE — Mamadou Lamine just checked in
  {
    id: "notif-e07-01",
    userId: EXPANSION_PARTICIPANTS[3].uid, // Mamadou Lamine
    type: "check_in_success",
    title: "Check-in réussi",
    body: "Vous êtes enregistré(e) au Meetup Dev Dakar #13. Bon meetup !",
    data: { eventId: "event-007" },
    isRead: false,
    readAt: null,
    createdAt: oneHourAgo,
  },
  // event-007 — Ndeye Rama — new announcement from Djibril
  {
    id: "notif-e07-02",
    userId: EXPANSION_PARTICIPANTS[4].uid,
    type: "new_announcement",
    title: "Nouvelle annonce",
    body: "Djibril Mbaye a publié une annonce pour Meetup Dev Dakar #13",
    data: { eventId: "event-007", postId: "post-e07-01" },
    isRead: false,
    readAt: null,
    createdAt: twoHoursAgo,
  },
  // event-008 LIVE — Fatou Binetou just checked in
  {
    id: "notif-e08-01",
    userId: EXPANSION_PARTICIPANTS[16].uid,
    type: "check_in_success",
    title: "Check-in réussi",
    body: "Bienvenue au Workshop Design Digital à l'Institut Français de Saint-Louis !",
    data: { eventId: "event-008" },
    isRead: true,
    readAt: oneHourAgo,
    createdAt: oneHourAgo,
  },
  // event-010 — Omar Fintech registration confirmed
  {
    id: "notif-e10-01",
    userId: EXPANSION_PARTICIPANTS[13].uid,
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Votre inscription à la Conférence Fintech Ouest-Africaine est confirmée.",
    data: { eventId: "event-010" },
    isRead: true,
    readAt: twoWeeksAgo,
    createdAt: twoWeeksAgo,
  },
  // event-011 — Binta concert reminder
  {
    id: "notif-e11-01",
    userId: EXPANSION_PARTICIPANTS[12].uid,
    type: "new_announcement",
    title: "Nouvelle annonce",
    body: "Mame Diarra Seck a publié une annonce pour Concert Youssou N'Dour Dakar",
    data: { eventId: "event-011", postId: "post-e11-01" },
    isRead: false,
    readAt: null,
    createdAt: oneWeekAgo,
  },
  // event-014 — Simon Flutter Ziguinchor reminder
  {
    id: "notif-e14-01",
    userId: EXPANSION_PARTICIPANTS[19].uid,
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Votre inscription à la Formation Flutter avancée à Ziguinchor est confirmée.",
    data: { eventId: "event-014" },
    isRead: false,
    readAt: null,
    createdAt: twoWeeksAgo,
  },
  // event-017 — Kouamé AfricaTech Online
  {
    id: "notif-e17-01",
    userId: EXPANSION_PARTICIPANTS[21].uid,
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Vous êtes inscrit(e) à l'AfricaTech Online Conference 2026.",
    data: { eventId: "event-017" },
    isRead: true,
    readAt: twoDaysAgo,
    createdAt: twoDaysAgo,
  },
  // event-020 — Serge atelier IA Abidjan
  {
    id: "notif-e20-01",
    userId: EXPANSION_PARTICIPANTS[23].uid,
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Votre inscription à l'Atelier IA Appliquée — Abidjan est confirmée.",
    data: { eventId: "event-020" },
    isRead: false,
    readAt: null,
    createdAt: twoWeeksAgo,
  },
  // event-009 — Koffi formation IA Bamako (online)
  {
    id: "notif-e09-01",
    userId: EXPANSION_PARTICIPANTS[26].uid, // Koffi (Lomé)
    type: "registration_confirmed",
    title: "Inscription confirmée",
    body: "Votre inscription à la Formation IA pour Cadres Dirigeants est confirmée.",
    data: { eventId: "event-009" },
    isRead: false,
    readAt: null,
    createdAt: yesterday,
  },
  // ── Backoffice-targeted seeds (Phase A.5) ──────────────────────────────
  // The bell in apps/web-backoffice needs visible data on a fresh staging
  // boot. The legacy set above is participant-facing only, so we seed a
  // handful of organizer / co-organizer / super-admin notifications with
  // deepLink values so clicking a row in the bell actually routes to a
  // real page in the dashboard.
  {
    id: "notif-bo-001",
    userId: IDS.organizer,
    type: "registration_confirmed",
    title: "Nouvelle inscription",
    body: "Aminata Fall s'est inscrite au Dakar Tech Summit 2026.",
    data: { eventId: IDS.conference, deepLink: `/events/${IDS.conference}/registrations` },
    isRead: false,
    readAt: null,
    createdAt: oneHourAgo,
  },
  {
    id: "notif-bo-002",
    userId: IDS.organizer,
    type: "payment_success",
    title: "Paiement reçu",
    body: "Paiement de 25 000 XOF reçu pour la Masterclass IA.",
    data: { eventId: IDS.paidEvent, deepLink: "/finance" },
    isRead: false,
    readAt: null,
    createdAt: twoHoursAgo,
  },
  {
    id: "notif-bo-003",
    userId: IDS.organizer,
    type: "system",
    title: "Limite de votre plan approchée",
    body: "Vous avez utilisé 80% de votre quota de participants pour ce mois.",
    data: { organizationId: IDS.orgId, deepLink: "/organization/billing" },
    isRead: false,
    readAt: null,
    createdAt: yesterday,
  },
  {
    id: "notif-bo-004",
    userId: IDS.coOrganizer,
    type: "event_published",
    title: "Événement publié",
    body: "Le Dakar Tech Summit 2026 a été publié avec succès.",
    data: { eventId: IDS.conference, deepLink: `/events/${IDS.conference}` },
    isRead: true,
    readAt: twoDaysAgo,
    createdAt: twoDaysAgo,
  },
  {
    id: "notif-bo-005",
    userId: IDS.starterOrganizer,
    type: "system",
    title: "Nouveau membre ajouté",
    body: "Oumar Ba a ajouté Aïssatou Diallo comme co-organisatrice.",
    data: { organizationId: IDS.starterOrgId, deepLink: "/organization/members" },
    isRead: false,
    readAt: null,
    createdAt: yesterday,
  },
  {
    id: "notif-bo-006",
    userId: IDS.superAdmin,
    type: "system",
    title: "Bounce rate élevé détecté",
    body: "Le domaine news@ dépasse 2% de bounces sur la dernière heure.",
    data: { deepLink: "/admin/notifications" },
    isRead: false,
    readAt: null,
    createdAt: oneHourAgo,
  },
];

async function writeNotifications(db: Firestore): Promise<number> {
  const all = [...LEGACY_NOTIFICATIONS, ...EXPANSION_NOTIFICATIONS];
  await Promise.all(
    all.map((n) =>
      db
        .collection("notifications")
        .doc(n.id)
        .set({ ...n, imageURL: null }),
    ),
  );
  return all.length;
}

const LEGACY_PREF_USERS = [IDS.participant1, IDS.participant2, IDS.speakerUser];
// 6 expansion participants get notification preferences — mix of cities so
// the admin UI has non-Dakar rows. Other expansion users rely on the
// onUserCreated trigger's default preferences (which the seed doesn't
// materialise to avoid bloating the fixture).
const EXPANSION_PREF_USERS: string[] = [
  EXPANSION_PARTICIPANTS[0].uid, // Mariama (Dakar)
  EXPANSION_PARTICIPANTS[10].uid, // Yacine (Saly)
  EXPANSION_PARTICIPANTS[13].uid, // Omar (Thiès)
  EXPANSION_PARTICIPANTS[16].uid, // Fatou Binetou (Saint-Louis)
  EXPANSION_PARTICIPANTS[21].uid, // Kouamé (Abidjan)
  EXPANSION_PARTICIPANTS[26].uid, // Koffi (Lomé)
];

async function writeNotificationPreferences(db: Firestore): Promise<number> {
  const all = [...LEGACY_PREF_USERS, ...EXPANSION_PREF_USERS];
  // Seed a mix of pref shapes so the backoffice "Communications"
  // page + Phase 2.5 history page have visible data on day 1:
  //   - Most users: aggregate on (legacy shape, still honoured).
  //   - Every 3rd user: per-category overrides (Phase 3c.3) —
  //     keeps organizational mail on but opts out of marketing.
  //   - Every 5th user: per-key object shape (Phase 2.6) — opts
  //     out of SMS for event.reminder while keeping email on.
  // Mandatory categories (auth, billing) are unaffected regardless.
  await Promise.all(
    all.map((uid, index) => {
      const base: Record<string, unknown> = {
        id: uid,
        userId: uid,
        email: true,
        sms: true,
        push: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        updatedAt: now,
      };
      if (index % 3 === 0) {
        base.emailTransactional = true;
        base.emailOrganizational = true;
        base.emailMarketing = false;
      }
      if (index % 5 === 0) {
        base.byKey = {
          "event.reminder": { email: true, sms: false, push: true },
          "newsletter.welcome": false,
        };
      }
      return db.collection("notificationPreferences").doc(uid).set(base);
    }),
  );
  return all.length;
}

// ─── Broadcasts ────────────────────────────────────────────────────────────

type SeedBroadcast = {
  id: string;
  eventId: string;
  organizationId: string;
  title: string;
  body: string;
  channels: string[];
  recipientFilter: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
};

const LEGACY_BROADCASTS: SeedBroadcast[] = [
  {
    id: IDS.broadcast1,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    title: "Rappel : Dakar Tech Summit dans 1 semaine",
    body: "Chers participants, le Dakar Tech Summit 2026 démarre dans 7 jours au CICAD. Consultez le programme et préparez vos questions ! À bientôt 🎉",
    channels: ["email", "push"],
    recipientFilter: "all",
    recipientCount: 4,
    sentCount: 4,
    failedCount: 0,
    status: "sent",
    createdBy: IDS.organizer,
    createdAt: yesterday,
    sentAt: yesterday,
  },
];

// 2 expansion broadcasts — one on the upcoming Fintech conference
// (starter tier) and one on the AfricaTech Online (enterprise), so the
// broadcasts list shows realistic multi-org traffic.
const EXPANSION_BROADCASTS: SeedBroadcast[] = [
  {
    id: "broadcast-e10-01",
    eventId: "event-010",
    organizationId: IDS.starterOrgId,
    title: "Fintech Ouest-Africaine — J-10, préparez votre venue",
    body: "Plus que 10 jours avant la Conférence Fintech Ouest-Africaine à Thiès ! Retrouvez le plan d'accès et les partenaires hôtels dans le lien inclus. À très vite 🙌",
    channels: ["email", "push"],
    recipientFilter: "all",
    recipientCount: 4,
    sentCount: 4,
    failedCount: 0,
    status: "sent",
    createdBy: IDS.starterOrganizer,
    createdAt: twoDaysAgo,
    sentAt: twoDaysAgo,
  },
  {
    id: "broadcast-e17-01",
    eventId: "event-017",
    organizationId: IDS.enterpriseOrgId,
    title: "AfricaTech 2026 — programme complet publié",
    body: "Le programme détaillé de l'AfricaTech Online Conference 2026 est en ligne : 8 tracks, 50 intervenants, 4 démos. Rejoignez-nous le jour J !",
    channels: ["email"],
    recipientFilter: "all",
    recipientCount: 5,
    sentCount: 5,
    failedCount: 0,
    status: "sent",
    createdBy: IDS.enterpriseOrganizer,
    createdAt: oneWeekAgo,
    sentAt: oneWeekAgo,
  },
];

async function writeBroadcasts(db: Firestore): Promise<number> {
  const all = [...LEGACY_BROADCASTS, ...EXPANSION_BROADCASTS];
  await Promise.all(all.map((b) => db.collection("broadcasts").doc(b.id).set(b)));
  return all.length;
}

// ─── Check-in feed ────────────────────────────────────────────────────────

async function writeCheckinFeed(db: Firestore): Promise<number> {
  await db.collection("checkinFeed").doc("checkin-001").set({
    id: "checkin-001",
    eventId: IDS.conference,
    registrationId: IDS.reg1,
    userId: IDS.participant1,
    userName: "Aminata Fall",
    ticketType: "Standard",
    checkedInBy: IDS.organizer,
    checkedInAt: oneHourAgo,
    method: "qr_scan",
  });
  return 1;
}

// ─── Audit logs ────────────────────────────────────────────────────────────

type AuditEntry = {
  action: string;
  resourceType: string;
  resourceId: string;
  actorId: string;
  eventId: string | null;
  organizationId: string | null;
  details: Record<string, unknown>;
};

// Legacy audit entries preserve the byte-for-byte behaviour of the previous
// monolith, which tagged every row with `IDS.orgId`. That's factually wrong
// for rows like `organization.verified` on `IDS.venueOrgId` (should be the
// venue org), but we hold the line on legacy bytes and only fix the
// expansion rows below — the CI check that audits this file (see
// `domain-event-auditor` subagent) still snapshots the monolith-derived
// payloads. A follow-up PR can backport the per-actor `organizationId` to
// the legacy rows once downstream consumers are confirmed safe.
const LEGACY_AUDIT: AuditEntry[] = [
  {
    action: "event.created",
    resourceType: "event",
    resourceId: IDS.conference,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    details: { title: "Dakar Tech Summit 2026" },
  },
  {
    action: "event.published",
    resourceType: "event",
    resourceId: IDS.conference,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    details: {},
  },
  {
    action: "registration.created",
    resourceType: "registration",
    resourceId: IDS.reg1,
    actorId: IDS.participant1,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    details: { ticketType: "Standard" },
  },
  {
    action: "checkin.completed",
    resourceType: "registration",
    resourceId: IDS.reg1,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    details: { method: "qr_scan" },
  },
  {
    action: "sponsor.added",
    resourceType: "sponsor",
    resourceId: IDS.sponsor1,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    details: { companyName: "TechCorp Dakar" },
  },
  {
    action: "venue.created",
    resourceType: "venue",
    resourceId: IDS.venue1,
    actorId: IDS.venueManager,
    eventId: null,
    organizationId: IDS.orgId,
    details: { name: "CICAD" },
  },
  {
    action: "venue.approved",
    resourceType: "venue",
    resourceId: IDS.venue1,
    actorId: IDS.superAdmin,
    eventId: null,
    organizationId: IDS.orgId,
    details: { name: "CICAD" },
  },
  {
    action: "venue.created",
    resourceType: "venue",
    resourceId: IDS.venue2,
    actorId: IDS.venueManager,
    eventId: null,
    organizationId: IDS.orgId,
    details: { name: "Radisson Blu" },
  },
  {
    action: "organization.verified",
    resourceType: "organization",
    resourceId: IDS.venueOrgId,
    actorId: IDS.superAdmin,
    eventId: null,
    organizationId: IDS.orgId,
    details: { orgName: "Dakar Venues & Hospitality" },
  },
  {
    action: "user.role_changed",
    resourceType: "user",
    resourceId: IDS.venueManager,
    actorId: IDS.superAdmin,
    eventId: null,
    organizationId: IDS.orgId,
    details: { newRoles: ["venue_manager"] },
  },
  {
    action: "subscription.upgraded",
    resourceType: "organization",
    resourceId: IDS.orgId,
    actorId: IDS.organizer,
    eventId: null,
    organizationId: IDS.orgId,
    details: { from: "free", to: "pro" },
  },
  {
    action: "subscription.upgraded",
    resourceType: "organization",
    resourceId: IDS.enterpriseOrgId,
    actorId: IDS.enterpriseOrganizer,
    eventId: null,
    organizationId: IDS.orgId,
    details: { from: "free", to: "enterprise" },
  },
];

// Expansion audit entries — each tagged with the correct `organizationId`
// (derived either from the event it references or from the actor's home
// org). Event rows iterate `EXPANSION_EVENT_DENORM` so a future event-list
// tweak in `04-events.ts` flows through without editing this module.
const EXPANSION_AUDIT: AuditEntry[] = [
  {
    action: "organization.created",
    resourceType: "organization",
    resourceId: IDS.starterOrgId,
    actorId: IDS.superAdmin,
    eventId: null,
    organizationId: IDS.starterOrgId,
    details: { orgName: "Thiès Tech Collective", plan: "starter" },
  },
  {
    action: "venue.approved",
    resourceType: "venue",
    resourceId: "venue-008",
    actorId: IDS.superAdmin,
    eventId: null,
    organizationId: IDS.starterOrgId,
    details: { name: "Palais des Congrès de Thiès" },
  },
  {
    action: "venue.approved",
    resourceType: "venue",
    resourceId: "venue-010",
    actorId: IDS.superAdmin,
    eventId: null,
    organizationId: IDS.starterOrgId,
    details: { name: "Institut Français de Saint-Louis" },
  },
  // event.created entries derived from EXPANSION_EVENT_DENORM so the audit
  // row's organizationId matches the event's own organizationId.
  ...EXPANSION_EVENT_DENORM.map<AuditEntry>((e) => ({
    action: "event.created",
    resourceType: "event",
    resourceId: e.id,
    actorId: e.createdBy,
    eventId: e.id,
    organizationId: e.organizationId,
    details: { title: e.title },
  })),
];

async function writeAuditLogs(db: Firestore): Promise<number> {
  const all = [...LEGACY_AUDIT, ...EXPANSION_AUDIT];
  await Promise.all(
    all.map((entry, i) => {
      const id = `audit-${String(i + 1).padStart(3, "0")}`;
      return db
        .collection("auditLogs")
        .doc(id)
        .set({
          id,
          ...entry,
          requestId: `seed-req-${i + 1}`,
          timestamp: yesterday,
        });
    }),
  );
  return all.length;
}

// ─── Subscriptions ────────────────────────────────────────────────────────

async function writeSubscriptions(db: Firestore): Promise<number> {
  const periodStart = twoDaysAgo;
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // `priceXof` is read from the shared `PLAN_DISPLAY` catalogue instead of
  // being re-declared here, so any price change in `@teranga/shared-types`
  // flows into the seed without a manual sync.
  const subs: Array<{ id: string; organizationId: string; plan: OrganizationPlan }> = [
    { id: "sub-001", organizationId: IDS.venueOrgId, plan: "starter" },
    { id: "sub-002", organizationId: IDS.orgId, plan: "pro" },
    { id: "sub-003", organizationId: IDS.enterpriseOrgId, plan: "enterprise" },
  ];

  await Promise.all(
    subs.map((s) =>
      db
        .collection("subscriptions")
        .doc(s.id)
        .set({
          ...s,
          priceXof: PLAN_DISPLAY[s.plan].priceXof,
          status: "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
          cancelReason: null,
          paymentMethod: null,
          createdAt: twoDaysAgo,
          updatedAt: now,
        }),
    ),
  );
  return subs.length;
}

// ─── Notification Settings (admin control plane) ─────────────────────────
// Seeds a handful of admin overrides on top of the 34-entry catalog so
// the super-admin notifications page (apps/web-backoffice/.../admin/
// notifications/page.tsx) has something to show on first boot of
// staging — a disabled key, a subject override, and an org-scoped
// override demonstrate every code path in the resolution service.

async function writeNotificationSettings(db: Firestore): Promise<number> {
  const seedActor = "system-seed";
  const overrides = [
    // Platform-wide: turn off the weekly welcome newsletter in
    // staging so QA can't accidentally spam seeded users during
    // demo runs.
    {
      docId: "newsletter.welcome",
      body: {
        key: "newsletter.welcome",
        enabled: false,
        channels: ["email"],
        updatedAt: now,
        updatedBy: seedActor,
      },
    },
    // Platform-wide: override the subject line for event.reminder
    // in French so the admin UI's "sujet" column isn't empty for
    // the most-fired notification.
    {
      docId: "event.reminder",
      body: {
        key: "event.reminder",
        enabled: true,
        channels: ["email", "push", "in_app"],
        subjectOverride: {
          fr: "Votre événement approche ✨",
          en: "Your event is coming up ✨",
          wo: "Sa xew bi am na ci yoon ✨",
        },
        updatedAt: now,
        updatedBy: seedActor,
      },
    },
    // Org-scoped: Dakar Digital Hub (starter plan) disables the
    // approaching-limit nudge for its own usage. Doc id encodes
    // the (key, orgId) tuple via the "__" separator the
    // notification-settings repository uses.
    {
      docId: "subscription.approaching_limit__org_dakar_digital_hub",
      body: {
        key: "subscription.approaching_limit",
        organizationId: "org_dakar_digital_hub",
        enabled: false,
        channels: [],
        updatedAt: now,
        updatedBy: seedActor,
      },
    },
  ];
  await Promise.all(
    overrides.map((o) => db.collection("notificationSettings").doc(o.docId).set(o.body)),
  );
  return overrides.length;
}

// ─── Notification Settings History (append-only edit log) ────────────────
// One prior-version entry per seeded NotificationSetting override so the
// admin UI history panel has non-empty data on first boot. Doc ids are
// deterministic (`history-<settingKey>-0001`) — re-running the seed writes
// to the same docs rather than duplicating rows.

async function writeNotificationSettingsHistory(db: Firestore): Promise<number> {
  const actor = IDS.superAdmin;
  const entries = [
    // newsletter.welcome: previously enabled on email; we just flipped it off.
    {
      docId: "history-newsletter-welcome-0001",
      key: "newsletter.welcome",
      organizationId: null,
      previousValue: {
        key: "newsletter.welcome",
        enabled: true,
        channels: ["email"],
        updatedAt: oneWeekAgo,
        updatedBy: actor,
      },
      newValue: {
        key: "newsletter.welcome",
        enabled: false,
        channels: ["email"],
        updatedAt: now,
        updatedBy: "system-seed",
      },
      diff: ["enabled", "updatedAt", "updatedBy"],
      actorId: actor,
      actorRole: "super_admin",
      reason: "QA staging: stop the welcome newsletter from firing against seed users.",
      changedAt: now,
    },
    // event.reminder: previously the default subject; we just added French + English + Wolof overrides.
    {
      docId: "history-event-reminder-0001",
      key: "event.reminder",
      organizationId: null,
      previousValue: {
        key: "event.reminder",
        enabled: true,
        channels: ["email", "push", "in_app"],
        updatedAt: twoWeeksAgo,
        updatedBy: actor,
      },
      newValue: {
        key: "event.reminder",
        enabled: true,
        channels: ["email", "push", "in_app"],
        subjectOverride: {
          fr: "Votre événement approche ✨",
          en: "Your event is coming up ✨",
          wo: "Sa xew bi am na ci yoon ✨",
        },
        updatedAt: now,
        updatedBy: "system-seed",
      },
      diff: ["subjectOverride", "updatedAt", "updatedBy"],
      actorId: actor,
      actorRole: "super_admin",
      reason: "Added locale-aware subject lines to match the landing copy.",
      changedAt: now,
    },
    // subscription.approaching_limit per org_dakar_digital_hub — no prior
    // override (previousValue: null) so the history panel also shows the
    // "first-time creation" shape, not just edits.
    {
      docId: "history-subscription-approaching-limit-dakar-0001",
      key: "subscription.approaching_limit",
      organizationId: "org_dakar_digital_hub",
      previousValue: null,
      newValue: {
        key: "subscription.approaching_limit",
        organizationId: "org_dakar_digital_hub",
        enabled: false,
        channels: [],
        updatedAt: now,
        updatedBy: "system-seed",
      },
      diff: ["enabled", "channels", "organizationId", "updatedAt", "updatedBy"],
      actorId: actor,
      actorRole: "super_admin",
      reason: "Org opted out of approaching-limit nudges pending product rework.",
      changedAt: now,
    },
  ];

  await Promise.all(
    entries.map((e) =>
      db.collection("notificationSettingsHistory").doc(e.docId).set({
        id: e.docId,
        key: e.key,
        organizationId: e.organizationId,
        previousValue: e.previousValue,
        newValue: e.newValue,
        diff: e.diff,
        actorId: e.actorId,
        actorRole: e.actorRole,
        reason: e.reason,
        changedAt: e.changedAt,
      }),
    ),
  );
  return entries.length;
}

// ─── Email suppressions (bounce + complaint list) ─────────────────────────
// One seed entry representing a hard-bounced address so the admin
// "Suppressions" page has visible data on day 1. Doc id = lowercased email
// (matches the Cloud Function behaviour — see apps/functions/src/triggers/
// resend/resend-webhook.https.ts suppressEmail()).

async function writeEmailSuppressions(db: Firestore): Promise<number> {
  const email = "hard-bounce@dev-suppressed.test";
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await db.collection("emailSuppressions").doc(email).set({
    email,
    reason: "bounced",
    source: "resend.webhook",
    sourceEmailId: "seed-resend-evt-0001",
    createdAt: threeDaysAgo,
  });
  return 1;
}

// ─── Newsletter subscribers (double-opt-in flow) ──────────────────────────
// 2 confirmed subscribers + 1 pending — exercises every branch of the
// double-opt-in lifecycle the admin dashboard needs to render.

async function writeNewsletterSubscribers(db: Firestore): Promise<number> {
  const subscribers = [
    {
      id: "newsletter-sub-001",
      email: "subscriber1@teranga.dev",
      status: "confirmed" as const,
      isActive: true,
      source: "website",
      subscribedAt: oneWeekAgo,
      confirmedAt: oneWeekAgo,
      ipAddress: "196.171.0.42",
      userAgent: "Mozilla/5.0 (seed fixture)",
      createdAt: oneWeekAgo,
      updatedAt: oneWeekAgo,
    },
    {
      id: "newsletter-sub-002",
      email: "subscriber2@teranga.dev",
      status: "confirmed" as const,
      isActive: true,
      source: "website",
      subscribedAt: twoWeeksAgo,
      confirmedAt: twoWeeksAgo,
      ipAddress: "41.214.0.18",
      userAgent: "Mozilla/5.0 (seed fixture)",
      createdAt: twoWeeksAgo,
      updatedAt: twoWeeksAgo,
    },
    {
      id: "newsletter-sub-003",
      email: "pending-subscriber@teranga.dev",
      status: "pending" as const,
      isActive: false,
      source: "website",
      subscribedAt: yesterday,
      confirmedAt: null,
      ipAddress: "41.214.0.19",
      userAgent: "Mozilla/5.0 (seed fixture)",
      createdAt: yesterday,
      updatedAt: yesterday,
    },
  ];

  await Promise.all(
    subscribers.map((s) => db.collection("newsletterSubscribers").doc(s.id).set(s)),
  );
  return subscribers.length;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export type SocialCounts = {
  feedPosts: number;
  feedComments: number;
  conversations: number;
  messages: number;
  notifications: number;
  notificationPreferences: number;
  notificationSettings: number;
  notificationSettingsHistory: number;
  broadcasts: number;
  checkinFeed: number;
  auditLogs: number;
  subscriptions: number;
  emailSuppressions: number;
  newsletterSubscribers: number;
};

export async function seedSocial(db: Firestore): Promise<SocialCounts> {
  const [
    feedPosts,
    feedComments,
    convResult,
    notifications,
    notificationPreferences,
    notificationSettings,
    notificationSettingsHistory,
    broadcasts,
    checkinFeed,
    auditLogs,
    subscriptions,
    emailSuppressions,
    newsletterSubscribers,
  ] = await Promise.all([
    writeFeedPosts(db),
    writeFeedComments(db),
    writeConversationsAndMessages(db),
    writeNotifications(db),
    writeNotificationPreferences(db),
    writeNotificationSettings(db),
    writeNotificationSettingsHistory(db),
    writeBroadcasts(db),
    writeCheckinFeed(db),
    writeAuditLogs(db),
    writeSubscriptions(db),
    writeEmailSuppressions(db),
    writeNewsletterSubscribers(db),
  ]);
  return {
    feedPosts,
    feedComments,
    conversations: convResult.conversations,
    messages: convResult.messages,
    notifications,
    notificationPreferences,
    notificationSettings,
    notificationSettingsHistory,
    broadcasts,
    checkinFeed,
    auditLogs,
    subscriptions,
    emailSuppressions,
    newsletterSubscribers,
  };
}
