/**
 * Firestore Security Rules Test Suite
 *
 * Tests the 502-line security rules at infrastructure/firebase/firestore.rules.
 * Covers: deny-all default, users, organizations, events, registrations,
 * badges, notifications, payments, audit logs, feed posts, conversations,
 * venues, and newsletter subscribers.
 *
 * NOTE: Rules that require cross-document reads via get() (sessions, speakers,
 * sponsors, broadcasts, promo codes) are skipped — the rules-unit-testing
 * emulator handles these inconsistently. Those rules should be tested via
 * integration tests with the full Firebase emulator suite.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { resolve } from "path";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "test-rules-" + Date.now(),
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authed(uid: string, claims: Record<string, unknown> = {}) {
  return testEnv.authenticatedContext(uid, claims);
}

function orgUser(uid: string, orgId: string, roles: string[] = ["organizer"]) {
  return authed(uid, { roles, organizationId: orgId });
}

function superAdmin(uid = "admin-1") {
  return authed(uid, { roles: ["super_admin"] });
}

function participant(uid = "user-1") {
  return authed(uid, { roles: ["participant"] });
}

function _staff(uid: string, orgId: string) {
  return authed(uid, { roles: ["staff"], organizationId: orgId });
}

function unauthed() {
  return testEnv.unauthenticatedContext();
}

async function seed(collection: string, docId: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection(collection).doc(docId).set(data);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Deny-all default", () => {
  it("denies unauthenticated read to any collection", async () => {
    await seed("randomCollection", "doc-1", { data: "test" });
    const db = unauthed().firestore();
    await assertFails(db.collection("randomCollection").doc("doc-1").get());
  });

  it("denies authenticated read to unknown collection", async () => {
    await seed("randomCollection", "doc-1", { data: "test" });
    const db = participant().firestore();
    await assertFails(db.collection("randomCollection").doc("doc-1").get());
  });

  it("denies unauthenticated write to any collection", async () => {
    const db = unauthed().firestore();
    await assertFails(db.collection("randomCollection").doc("doc-1").set({ x: 1 }));
  });
});

describe("Users", () => {
  const userId = "user-1";
  const userData = {
    displayName: "Test User",
    email: "test@example.com",
    photoURL: null,
    phone: null,
    bio: null,
    roles: ["participant"],
    organizationId: null,
    preferredLanguage: "fr",
    fcmTokens: [],
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  beforeEach(async () => {
    await seed("users", userId, userData);
  });

  it("allows owner to read own profile", async () => {
    const db = participant(userId).firestore();
    await assertSucceeds(db.collection("users").doc(userId).get());
  });

  it("denies other user from reading profile", async () => {
    const db = participant("other-user").firestore();
    await assertFails(db.collection("users").doc(userId).get());
  });

  it("allows super_admin to read any profile", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(db.collection("users").doc(userId).get());
  });

  it("allows owner to update allowed fields", async () => {
    const db = participant(userId).firestore();
    await assertSucceeds(
      db.collection("users").doc(userId).update({
        displayName: "New Name",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    );
  });

  it("denies owner from updating roles", async () => {
    const db = participant(userId).firestore();
    await assertFails(
      db
        .collection("users")
        .doc(userId)
        .update({
          roles: ["super_admin"],
        }),
    );
  });

  it("denies owner from updating isActive", async () => {
    const db = participant(userId).firestore();
    await assertFails(
      db.collection("users").doc(userId).update({
        isActive: false,
      }),
    );
  });

  it("allows super_admin to update any field including roles", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(
      db
        .collection("users")
        .doc(userId)
        .update({
          roles: ["organizer"],
          isActive: false,
        }),
    );
  });

  it("denies user creation (Cloud Functions only)", async () => {
    const db = participant().firestore();
    await assertFails(db.collection("users").doc("new-user").set({ displayName: "New" }));
  });

  it("denies user deletion", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("users").doc(userId).delete());
  });

  // ── Organizer cross-member reads (firestore.rules:59) ───────────────────
  // Regression guard: this rule branch was de-facto dead before the
  // Class B mirror PR (#64) started writing organizationId onto the
  // member's user doc. These tests prove the branch is now live AND
  // still correctly scoped to the organizer's own org.

  describe("organizer read of a co-member's profile", () => {
    const orgId = "org-acme";
    const memberId = "member-2";
    const memberData = {
      ...userData,
      roles: ["participant"],
      organizationId: orgId, // mirrored by organization.service.addMember / invite.accept
    };

    beforeEach(async () => {
      await seed("users", memberId, memberData);
    });

    it("allows an organizer of the same org to read a member's profile", async () => {
      const db = orgUser("org-admin-1", orgId).firestore();
      await assertSucceeds(db.collection("users").doc(memberId).get());
    });

    it("denies an organizer of a different org", async () => {
      const db = orgUser("org-admin-2", "org-other").firestore();
      await assertFails(db.collection("users").doc(memberId).get());
    });

    it("denies an organizer when the member doc has no organizationId (pre-mirror state)", async () => {
      // Seed a member whose user doc has NOT been mirrored. The rule
      // should now correctly reject — this is the state the Class B
      // bug produced for every invitee, which is why PR #64 was
      // required to make the rule actually enforceable.
      await seed("users", "legacy-member", { ...userData, organizationId: null });
      const db = orgUser("org-admin-1", orgId).firestore();
      await assertFails(db.collection("users").doc("legacy-member").get());
    });
  });
});

describe("Organizations", () => {
  const orgId = "org-1";
  const orgData = { ownerId: "alice", name: "Test Org", memberIds: ["alice"] };

  beforeEach(async () => {
    await seed("organizations", orgId, orgData);
  });

  it("allows org member to read", async () => {
    const db = orgUser("alice", orgId).firestore();
    await assertSucceeds(db.collection("organizations").doc(orgId).get());
  });

  it("denies non-member from reading", async () => {
    const db = orgUser("bob", "org-other").firestore();
    await assertFails(db.collection("organizations").doc(orgId).get());
  });

  it("allows super_admin to read any org", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(db.collection("organizations").doc(orgId).get());
  });

  it("allows authenticated user to create org with own uid as owner", async () => {
    const db = participant("bob").firestore();
    await assertSucceeds(
      db.collection("organizations").doc("org-new").set({
        ownerId: "bob",
        name: "Bob's Org",
      }),
    );
  });

  it("denies creating org with another user as owner", async () => {
    const db = participant("bob").firestore();
    await assertFails(
      db.collection("organizations").doc("org-new").set({
        ownerId: "alice",
        name: "Spoofed Org",
      }),
    );
  });

  it("allows org organizer to update", async () => {
    const db = orgUser("alice", orgId).firestore();
    await assertSucceeds(db.collection("organizations").doc(orgId).update({ name: "Updated" }));
  });

  it("allows only super_admin to delete", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(db.collection("organizations").doc(orgId).delete());
  });

  it("denies organizer from deleting", async () => {
    const db = orgUser("alice", orgId).firestore();
    await assertFails(db.collection("organizations").doc(orgId).delete());
  });
});

describe("Events", () => {
  beforeEach(async () => {
    await seed("events", "ev-pub", {
      status: "published",
      isPublic: true,
      organizationId: "org-1",
      createdBy: "alice",
      title: "Public Event",
    });
    await seed("events", "ev-draft", {
      status: "draft",
      isPublic: false,
      organizationId: "org-1",
      createdBy: "alice",
      title: "Draft Event",
    });
  });

  it("allows unauthenticated read of published public events", async () => {
    const db = unauthed().firestore();
    await assertSucceeds(db.collection("events").doc("ev-pub").get());
  });

  it("denies unauthenticated read of draft events", async () => {
    const db = unauthed().firestore();
    await assertFails(db.collection("events").doc("ev-draft").get());
  });

  it("allows org member to read draft events", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertSucceeds(db.collection("events").doc("ev-draft").get());
  });

  it("denies non-org member from reading draft events", async () => {
    const db = orgUser("bob", "org-other").firestore();
    await assertFails(db.collection("events").doc("ev-draft").get());
  });

  it("allows organizer in org to create event", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertSucceeds(
      db.collection("events").doc("ev-new").set({
        organizationId: "org-1",
        createdBy: "alice",
        status: "draft",
        title: "New Event",
      }),
    );
  });

  it("denies organizer from creating event in another org", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertFails(
      db.collection("events").doc("ev-new").set({
        organizationId: "org-other",
        createdBy: "alice",
        status: "draft",
      }),
    );
  });

  it("prevents changing organizationId on update (immutable)", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertFails(
      db.collection("events").doc("ev-pub").update({
        organizationId: "org-hijacked",
        title: "Hijacked",
      }),
    );
  });

  it("denies hard delete (soft-delete only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("events").doc("ev-pub").delete());
  });
});

describe("Registrations", () => {
  beforeEach(async () => {
    await seed("registrations", "reg-1", {
      userId: "user-1",
      eventId: "ev-1",
      ticketTypeId: "ticket-1",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("allows owner to read own registration", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(db.collection("registrations").doc("reg-1").get());
  });

  it("denies other user from reading registration", async () => {
    const db = participant("user-other").firestore();
    await assertFails(db.collection("registrations").doc("reg-1").get());
  });

  it("allows super_admin to read any registration", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(db.collection("registrations").doc("reg-1").get());
  });

  it("denies any participant from creating a registration directly (API-only)", async () => {
    // B2 follow-up — the create path was tightened from
    // `allow create: if isAuthenticated() && userId == currentUid()
    //                && status in [confirmed, pending, waitlisted]`
    // to `allow create: if false` because a direct write bypassed every
    // server-side guard (plan limits, capacity, QR signing, counter
    // increment, waitlist plan-feature gate). The API uses the Admin
    // SDK and is exempt from rules; clients (web-participant, web-
    // backoffice, mobile/Flutter) already route through the API.
    const db = participant("user-2").firestore();
    await assertFails(
      db.collection("registrations").doc("reg-new").set({
        userId: "user-2",
        eventId: "ev-1",
        ticketTypeId: "ticket-1",
        status: "confirmed",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );
  });

  it("denies creating registration with a spoofed userId (no longer creatable at all)", async () => {
    const db = participant("user-2").firestore();
    await assertFails(
      db.collection("registrations").doc("reg-new").set({
        userId: "user-spoofed",
        eventId: "ev-1",
        status: "confirmed",
      }),
    );
  });

  it("denies creating a waitlisted registration directly (API-only path closes plan-feature bypass)", async () => {
    // F3 — waitlist is now a plan feature gated to starter+. A free-tier
    // participant could have written a waitlisted registration directly
    // pre-fix and the API's gate would never run. The closed create rule
    // makes the gate unbypassable.
    const db = participant("user-2").firestore();
    await assertFails(
      db.collection("registrations").doc("reg-new").set({
        userId: "user-2",
        eventId: "ev-1",
        ticketTypeId: "ticket-1",
        status: "waitlisted",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );
  });

  it("allows owner to cancel own registration", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(
      db.collection("registrations").doc("reg-1").update({
        status: "cancelled",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    );
  });

  it("denies owner from changing status to non-cancelled value", async () => {
    const db = participant("user-1").firestore();
    await assertFails(
      db.collection("registrations").doc("reg-1").update({
        status: "checked_in",
        updatedAt: "2026-01-02T00:00:00Z",
      }),
    );
  });

  it("denies hard delete", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("registrations").doc("reg-1").delete());
  });
});

describe("Badges", () => {
  beforeEach(async () => {
    await seed("badges", "badge-1", {
      userId: "user-1",
      eventId: "ev-1",
      registrationId: "reg-1",
      status: "generated",
    });
  });

  it("allows owner to read own badge", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(db.collection("badges").doc("badge-1").get());
  });

  it("denies other user from reading badge", async () => {
    const db = participant("user-other").firestore();
    await assertFails(db.collection("badges").doc("badge-1").get());
  });

  it("denies all client writes (Admin SDK only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("badges").doc("new").set({ x: 1 }));
    await assertFails(db.collection("badges").doc("badge-1").update({ status: "x" }));
    await assertFails(db.collection("badges").doc("badge-1").delete());
  });
});

describe("Notifications", () => {
  beforeEach(async () => {
    await seed("notifications", "notif-1", {
      userId: "user-1",
      type: "event_reminder",
      title: "Reminder",
      isRead: false,
      readAt: null,
    });
  });

  it("allows owner to read own notifications", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(db.collection("notifications").doc("notif-1").get());
  });

  it("denies other user from reading notifications", async () => {
    const db = participant("user-other").firestore();
    await assertFails(db.collection("notifications").doc("notif-1").get());
  });

  it("allows owner to mark as read", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(
      db.collection("notifications").doc("notif-1").update({
        isRead: true,
        readAt: "2026-01-02T00:00:00Z",
      }),
    );
  });

  it("denies owner from changing other fields", async () => {
    const db = participant("user-1").firestore();
    await assertFails(
      db.collection("notifications").doc("notif-1").update({
        title: "Hacked",
      }),
    );
  });

  it("denies client creation (Admin SDK only)", async () => {
    const db = participant().firestore();
    await assertFails(
      db.collection("notifications").doc("new").set({
        userId: "user-1",
        type: "test",
      }),
    );
  });
});

describe("Payments", () => {
  beforeEach(async () => {
    await seed("payments", "pay-1", {
      userId: "user-1",
      eventId: "ev-1",
      amount: 5000,
      status: "succeeded",
    });
  });

  it("allows owner to read own payment", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(db.collection("payments").doc("pay-1").get());
  });

  it("denies all client writes (Admin SDK only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("payments").doc("new").set({ x: 1 }));
    await assertFails(db.collection("payments").doc("pay-1").update({ amount: 0 }));
    await assertFails(db.collection("payments").doc("pay-1").delete());
  });
});

describe("Audit Logs", () => {
  beforeEach(async () => {
    await seed("auditLogs", "log-1", { action: "event.created", actorId: "admin-1" });
  });

  it("allows super_admin to read", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(db.collection("auditLogs").doc("log-1").get());
  });

  it("denies non-admin from reading", async () => {
    const db = participant().firestore();
    await assertFails(db.collection("auditLogs").doc("log-1").get());
  });

  it("denies all client writes", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("auditLogs").doc("new").set({ action: "test" }));
  });
});

describe("Feed Posts", () => {
  beforeEach(async () => {
    await seed("feedPosts", "post-1", {
      authorId: "user-1",
      eventId: "ev-1",
      content: "Hello!",
    });
  });

  it("allows any authenticated user to read", async () => {
    const db = participant("user-2").firestore();
    await assertSucceeds(db.collection("feedPosts").doc("post-1").get());
  });

  it("denies unauthenticated read", async () => {
    const db = unauthed().firestore();
    await assertFails(db.collection("feedPosts").doc("post-1").get());
  });

  it("allows creating post with own authorId", async () => {
    const db = participant("user-2").firestore();
    await assertSucceeds(
      db.collection("feedPosts").doc("post-new").set({
        authorId: "user-2",
        eventId: "ev-1",
        content: "New post",
      }),
    );
  });

  it("denies creating post with another authorId", async () => {
    const db = participant("user-2").firestore();
    await assertFails(
      db.collection("feedPosts").doc("post-spoof").set({
        authorId: "user-1",
        content: "Spoofed",
      }),
    );
  });

  it("denies hard delete (soft-delete only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("feedPosts").doc("post-1").delete());
  });
});

describe("Conversations", () => {
  beforeEach(async () => {
    await seed("conversations", "conv-1", {
      participantIds: ["user-1", "user-2"],
      lastMessage: "Hello",
    });
  });

  it("allows participant to read their conversation", async () => {
    const db = participant("user-1").firestore();
    await assertSucceeds(db.collection("conversations").doc("conv-1").get());
  });

  it("denies non-participant from reading", async () => {
    const db = participant("user-3").firestore();
    await assertFails(db.collection("conversations").doc("conv-1").get());
  });

  it("allows creating conversation with self in participantIds", async () => {
    const db = participant("user-3").firestore();
    await assertSucceeds(
      db
        .collection("conversations")
        .doc("conv-new")
        .set({
          participantIds: ["user-3", "user-4"],
          lastMessage: null,
        }),
    );
  });

  it("denies creating conversation without self in participantIds", async () => {
    const db = participant("user-3").firestore();
    await assertFails(
      db
        .collection("conversations")
        .doc("conv-spoof")
        .set({
          participantIds: ["user-1", "user-4"],
          lastMessage: null,
        }),
    );
  });

  it("denies creating conversation with != 2 participants", async () => {
    const db = participant("user-3").firestore();
    await assertFails(
      db
        .collection("conversations")
        .doc("conv-group")
        .set({
          participantIds: ["user-3", "user-4", "user-5"],
        }),
    );
  });

  it("denies hard delete", async () => {
    const db = participant("user-1").firestore();
    await assertFails(db.collection("conversations").doc("conv-1").delete());
  });
});

describe("Venues", () => {
  beforeEach(async () => {
    await seed("venues", "venue-1", {
      name: "CICAD",
      hostOrganizationId: "org-1",
      status: "approved",
    });
  });

  it("allows any authenticated user to read", async () => {
    const db = participant().firestore();
    await assertSucceeds(db.collection("venues").doc("venue-1").get());
  });

  it("denies unauthenticated read", async () => {
    const db = unauthed().firestore();
    await assertFails(db.collection("venues").doc("venue-1").get());
  });

  it("allows organizer to create venue", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertSucceeds(db.collection("venues").doc("venue-new").set({ name: "New Venue" }));
  });

  it("denies participant from creating venue", async () => {
    const db = participant().firestore();
    await assertFails(db.collection("venues").doc("venue-new").set({ name: "No" }));
  });

  it("denies hard delete (soft-delete only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("venues").doc("venue-1").delete());
  });
});

describe("Newsletter Subscribers", () => {
  beforeEach(async () => {
    await seed("newsletterSubscribers", "sub-1", {
      email: "test@example.com",
      isActive: true,
    });
  });

  it("allows super_admin to read", async () => {
    const db = superAdmin().firestore();
    await assertSucceeds(db.collection("newsletterSubscribers").doc("sub-1").get());
  });

  it("denies non-admin from reading", async () => {
    const db = participant().firestore();
    await assertFails(db.collection("newsletterSubscribers").doc("sub-1").get());
  });

  it("denies all client writes (API only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("newsletterSubscribers").doc("new").set({ email: "x" }));
  });
});

// ─── Sprint C.3 — server-only collections (8 explicit deny / owner blocks) ──
//
// Each block below mirrors the rule structure in firestore.rules around
// the `Server-only collections` comment. The point of these tests is NOT
// to exercise business logic — these collections are entirely server-side
// — but to catch a future regression where someone flips `if false` to
// `if true` (or removes the explicit match block, falling back to the
// catch-all default which would silently still deny but with weaker
// auditability).

describe("Sprint C.3 — Payouts (server-only)", () => {
  beforeEach(async () => {
    await seed("payouts", "pay-1", { orgId: "org-1", amount: 100 });
  });

  it("denies authenticated read", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertFails(db.collection("payouts").doc("pay-1").get());
  });

  it("denies super_admin read (Admin SDK only)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("payouts").doc("pay-1").get());
  });

  it("denies any client write", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("payouts").doc("new").set({ amount: 1 }));
  });
});

describe("Sprint C.3 — Receipts (server-only)", () => {
  beforeEach(async () => {
    await seed("receipts", "rcp-1", { orgId: "org-1", total: 100 });
  });

  it("denies authenticated read (API only)", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertFails(db.collection("receipts").doc("rcp-1").get());
  });

  it("denies any client write", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("receipts").doc("new").set({ total: 1 }));
  });
});

describe("Sprint C.3 — Subscriptions (server-only)", () => {
  beforeEach(async () => {
    await seed("subscriptions", "sub-1", { orgId: "org-1", plan: "pro" });
  });

  it("denies org-owner read (clients use derived org doc — see ADR-0006)", async () => {
    const db = orgUser("alice", "org-1").firestore();
    await assertFails(db.collection("subscriptions").doc("sub-1").get());
  });

  it("denies any client write", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("subscriptions").doc("new").set({ plan: "free" }));
  });
});

describe("Sprint C.3 — Counters (server-only, transactional)", () => {
  beforeEach(async () => {
    await seed("counters", "ctr-1", { value: 0 });
  });

  it("denies any client read", async () => {
    const db = participant().firestore();
    await assertFails(db.collection("counters").doc("ctr-1").get());
  });

  it("denies any client write (would defeat transactional invariants)", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("counters").doc("ctr-1").update({ value: 999 }));
  });
});

describe("Sprint C.3 — Refund locks (server-only, short-lived)", () => {
  it("denies any client read", async () => {
    await seed("refundLocks", "lock-1", { acquiredAt: "2026-04-25T00:00:00Z" });
    const db = superAdmin().firestore();
    await assertFails(db.collection("refundLocks").doc("lock-1").get());
  });

  it("denies any client write", async () => {
    const db = superAdmin().firestore();
    await assertFails(db.collection("refundLocks").doc("new").set({ x: 1 }));
  });
});

describe("Sprint C.3 — Feature flags (server-only)", () => {
  beforeEach(async () => {
    await seed("featureFlags", "wave3-launch", { enabled: true });
  });

  it("denies any client read (would let callers enumerate the flag inventory)", async () => {
    const db = participant().firestore();
    await assertFails(db.collection("featureFlags").doc("wave3-launch").get());
  });

  it("denies super_admin direct write (super-admin uses the admin route)", async () => {
    const db = superAdmin().firestore();
    await assertFails(
      db.collection("featureFlags").doc("wave3-launch").update({ enabled: false }),
    );
  });
});

describe("Sprint C.3 — Notification preferences (owner-scoped)", () => {
  const ALICE = "user-alice";
  const BOB = "user-bob";

  beforeEach(async () => {
    await seed(`notificationPreferences`, ALICE, {
      emailDigest: "daily",
      smsTransactional: true,
    });
  });

  it("allows owner to read their own preferences", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertSucceeds(db.collection("notificationPreferences").doc(ALICE).get());
  });

  it("allows owner to update their own preferences", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertSucceeds(
      db.collection("notificationPreferences").doc(ALICE).update({ emailDigest: "weekly" }),
    );
  });

  it("denies another user from reading the owner's preferences", async () => {
    const db = authed(BOB, { roles: ["participant"] }).firestore();
    await assertFails(db.collection("notificationPreferences").doc(ALICE).get());
  });

  it("denies organizer from reading a participant's preferences", async () => {
    const db = orgUser("org-admin", "org-1").firestore();
    await assertFails(db.collection("notificationPreferences").doc(ALICE).get());
  });

  it("denies create from any client (server-side signup hook owns creation)", async () => {
    const db = authed("user-new", { roles: ["participant"] }).firestore();
    await assertFails(
      db.collection("notificationPreferences").doc("user-new").set({ emailDigest: "off" }),
    );
  });

  it("denies delete from owner (soft-managed via prefs payload)", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertFails(db.collection("notificationPreferences").doc(ALICE).delete());
  });
});

describe("Sprint C.3 — Session bookmarks (owner-scoped)", () => {
  const ALICE = "user-alice";
  const BOB = "user-bob";

  beforeEach(async () => {
    await seed("sessionBookmarks", "bm-alice-1", {
      userId: ALICE,
      sessionId: "session-1",
    });
  });

  it("allows owner to read their own bookmarks", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertSucceeds(db.collection("sessionBookmarks").doc("bm-alice-1").get());
  });

  it("allows owner to create a bookmark with their userId", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertSucceeds(
      db.collection("sessionBookmarks").doc("bm-alice-2").set({
        userId: ALICE,
        sessionId: "session-2",
      }),
    );
  });

  it("denies create with a different userId (impersonation)", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertFails(
      db.collection("sessionBookmarks").doc("bm-bob").set({
        userId: BOB,
        sessionId: "session-3",
      }),
    );
  });

  it("allows owner to delete their own bookmark", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertSucceeds(db.collection("sessionBookmarks").doc("bm-alice-1").delete());
  });

  it("denies another user from reading a bookmark", async () => {
    const db = authed(BOB, { roles: ["participant"] }).firestore();
    await assertFails(db.collection("sessionBookmarks").doc("bm-alice-1").get());
  });

  it("denies update (bookmarks are create-or-delete only)", async () => {
    const db = authed(ALICE, { roles: ["participant"] }).firestore();
    await assertFails(
      db.collection("sessionBookmarks").doc("bm-alice-1").update({ sessionId: "session-99" }),
    );
  });

  it("denies organizer cross-org bookmark read", async () => {
    const db = orgUser("org-admin", "org-1").firestore();
    await assertFails(db.collection("sessionBookmarks").doc("bm-alice-1").get());
  });
});
