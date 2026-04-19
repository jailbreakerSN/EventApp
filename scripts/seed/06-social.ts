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

import { Dates } from "./config";
import { IDS } from "./ids";

const { now, oneHourAgo, yesterday, twoDaysAgo } = Dates;

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

const EXPANSION_FEED_POSTS: SeedFeedPost[] = [];

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

const EXPANSION_NOTIFICATIONS: SeedNotification[] = [];

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
const EXPANSION_PREF_USERS: string[] = [];

async function writeNotificationPreferences(db: Firestore): Promise<number> {
  const all = [...LEGACY_PREF_USERS, ...EXPANSION_PREF_USERS];
  await Promise.all(
    all.map((uid) =>
      db.collection("notificationPreferences").doc(uid).set({
        id: uid,
        userId: uid,
        email: true,
        sms: true,
        push: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        updatedAt: now,
      }),
    ),
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

const EXPANSION_BROADCASTS: SeedBroadcast[] = [];

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
  details: Record<string, unknown>;
};

const LEGACY_AUDIT: AuditEntry[] = [
  {
    action: "event.created",
    resourceType: "event",
    resourceId: IDS.conference,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    details: { title: "Dakar Tech Summit 2026" },
  },
  {
    action: "event.published",
    resourceType: "event",
    resourceId: IDS.conference,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    details: {},
  },
  {
    action: "registration.created",
    resourceType: "registration",
    resourceId: IDS.reg1,
    actorId: IDS.participant1,
    eventId: IDS.conference,
    details: { ticketType: "Standard" },
  },
  {
    action: "registration.checked_in",
    resourceType: "registration",
    resourceId: IDS.reg1,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    details: { method: "qr_scan" },
  },
  {
    action: "sponsor.added",
    resourceType: "sponsor",
    resourceId: IDS.sponsor1,
    actorId: IDS.organizer,
    eventId: IDS.conference,
    details: { companyName: "TechCorp Dakar" },
  },
  {
    action: "venue.created",
    resourceType: "venue",
    resourceId: IDS.venue1,
    actorId: IDS.venueManager,
    eventId: null,
    details: { name: "CICAD" },
  },
  {
    action: "venue.approved",
    resourceType: "venue",
    resourceId: IDS.venue1,
    actorId: IDS.superAdmin,
    eventId: null,
    details: { name: "CICAD" },
  },
  {
    action: "venue.created",
    resourceType: "venue",
    resourceId: IDS.venue2,
    actorId: IDS.venueManager,
    eventId: null,
    details: { name: "Radisson Blu" },
  },
  {
    action: "organization.verified",
    resourceType: "organization",
    resourceId: IDS.venueOrgId,
    actorId: IDS.superAdmin,
    eventId: null,
    details: { orgName: "Dakar Venues & Hospitality" },
  },
  {
    action: "user.role_changed",
    resourceType: "user",
    resourceId: IDS.venueManager,
    actorId: IDS.superAdmin,
    eventId: null,
    details: { newRoles: ["venue_manager"] },
  },
  {
    action: "subscription.upgraded",
    resourceType: "organization",
    resourceId: IDS.orgId,
    actorId: IDS.organizer,
    eventId: null,
    details: { from: "free", to: "pro" },
  },
  {
    action: "subscription.upgraded",
    resourceType: "organization",
    resourceId: IDS.enterpriseOrgId,
    actorId: IDS.enterpriseOrganizer,
    eventId: null,
    details: { from: "free", to: "enterprise" },
  },
];

const EXPANSION_AUDIT: AuditEntry[] = [];

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
          organizationId: IDS.orgId,
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

  const subs = [
    {
      id: "sub-001",
      organizationId: IDS.venueOrgId,
      plan: "starter",
      priceXof: 9900,
    },
    {
      id: "sub-002",
      organizationId: IDS.orgId,
      plan: "pro",
      priceXof: 29900,
    },
    {
      id: "sub-003",
      organizationId: IDS.enterpriseOrgId,
      plan: "enterprise",
      priceXof: 0,
    },
  ];

  await Promise.all(
    subs.map((s) =>
      db
        .collection("subscriptions")
        .doc(s.id)
        .set({
          ...s,
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

// ─── Orchestrator ─────────────────────────────────────────────────────────

export type SocialCounts = {
  feedPosts: number;
  feedComments: number;
  conversations: number;
  messages: number;
  notifications: number;
  notificationPreferences: number;
  broadcasts: number;
  checkinFeed: number;
  auditLogs: number;
  subscriptions: number;
};

export async function seedSocial(db: Firestore): Promise<SocialCounts> {
  const [
    feedPosts,
    feedComments,
    convResult,
    notifications,
    notificationPreferences,
    broadcasts,
    checkinFeed,
    auditLogs,
    subscriptions,
  ] = await Promise.all([
    writeFeedPosts(db),
    writeFeedComments(db),
    writeConversationsAndMessages(db),
    writeNotifications(db),
    writeNotificationPreferences(db),
    writeBroadcasts(db),
    writeCheckinFeed(db),
    writeAuditLogs(db),
    writeSubscriptions(db),
  ]);
  return {
    feedPosts,
    feedComments,
    conversations: convResult.conversations,
    messages: convResult.messages,
    notifications,
    notificationPreferences,
    broadcasts,
    checkinFeed,
    auditLogs,
    subscriptions,
  };
}
