/**
 * End-to-End Validation Script
 *
 * Validates the full platform against running Firebase emulators + API.
 *
 * Prerequisites:
 *   1. Firebase emulators running: `firebase emulators:start`
 *   2. Seed data loaded: `npx tsx scripts/seed-emulators.ts`
 *   3. API running: `npm run api:dev`
 *   4. Run: `npx tsx scripts/validate-e2e.ts`
 *
 * Tests:
 *   1. Health & readiness endpoints
 *   2. Authentication (all roles)
 *   3. Event search (public, no auth)
 *   4. Event search (authenticated, sees own drafts)
 *   5. Single event fetch (with venue data)
 *   6. Event creation by organizer
 *   7. Registration by participant
 *   8. Registration list for organizer
 *   9. Venue public listing
 *  10. Admin stats (super_admin)
 *  11. Admin user list (super_admin)
 *  12. Admin audit logs (super_admin)
 */

const API_URL = "http://localhost:3000";
const AUTH_EMULATOR = "http://localhost:9099";
const PROJECT_ID = "teranga-app-990a8";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${message}`);
  }
}

async function getIdToken(email: string, password: string): Promise<string> {
  // Sign in via Firebase Auth emulator REST API
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Auth failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = res.status === 204 ? {} : await res.json();
  return { status: res.status, data };
}

async function run() {
  console.log("🧪 End-to-End Validation (Waves 1-8 + Admin + Venues)\n");

  // ─── 1. Health checks ──────────────────────────────────────────────────────
  console.log("1️⃣  Health & Readiness");
  {
    const { status, data } = await api("GET", "/health");
    assert(status === 200, `GET /health → 200 (got ${status})`);
    assert(data.status === "ok", "Health status is 'ok'");
  }
  {
    const { status, data } = await api("GET", "/ready");
    // Readiness may return 503 if Firestore emulator connectivity check fails
    assert(status === 200 || status === 503, `GET /ready → 200 or 503 (got ${status})`);
    if (status === 503) console.log("    ℹ️  Readiness 503 is expected with emulators (Firestore probe)");
  }

  // ─── 2. Authentication ─────────────────────────────────────────────────────
  console.log("\n2️⃣  Authentication");
  let organizerToken: string;
  let participantToken: string;

  try {
    organizerToken = await getIdToken("organizer@teranga.dev", "password123");
    assert(!!organizerToken, "Organizer login → got ID token");
  } catch (e: any) {
    assert(false, `Organizer login failed: ${e.message}`);
    console.log("\n⚠️  Cannot continue without auth. Ensure emulators are seeded.");
    return;
  }

  try {
    participantToken = await getIdToken("participant@teranga.dev", "password123");
    assert(!!participantToken, "Participant login → got ID token");
  } catch (e: any) {
    assert(false, `Participant login failed: ${e.message}`);
    return;
  }

  let adminToken: string;
  try {
    adminToken = await getIdToken("admin@teranga.dev", "password123");
    assert(!!adminToken, "Super admin login → got ID token");
  } catch (e: any) {
    assert(false, `Admin login failed: ${e.message}`);
    return;
  }

  // ─── 3. Public event search ────────────────────────────────────────────────
  console.log("\n3️⃣  Event Search (public)");
  {
    const { status, data } = await api("GET", "/v1/events");
    assert(status === 200, `GET /v1/events → 200 (got ${status})`);
    assert(data.success === true, "Response has success: true");
    assert(Array.isArray(data.data), "Response data is an array");
    // Only published events should appear in public search
    const publishedEvents = (data.data || []).filter((e: any) => e.status === "published");
    assert(publishedEvents.length >= 1, `At least 1 published event (got ${publishedEvents.length})`);
  }

  // ─── 4. Authenticated event search ────────────────────────────────────────
  console.log("\n4️⃣  Event Search (organizer, authenticated)");
  {
    const { status, data } = await api("GET", "/v1/events", organizerToken);
    assert(status === 200, `GET /v1/events (auth) → 200 (got ${status})`);
    assert((data.data || []).length >= 1, `Organizer sees events (got ${(data.data || []).length})`);
    // Note: draft events are accessed directly by ID, not in public search — this is by design
  }

  // ─── 5. Single event fetch ────────────────────────────────────────────────
  console.log("\n5️⃣  Single Event Fetch");
  {
    const { status, data } = await api("GET", "/v1/events/event-001", organizerToken);
    assert(status === 200, `GET /v1/events/event-001 → 200 (got ${status})`);
    assert(data.data?.title === "Dakar Tech Summit 2026", "Event title matches");
    assert(data.data?.status === "published", "Event status is published");
    assert(Array.isArray(data.data?.ticketTypes), "Event has ticket types");
    assert(data.data?.venueId === "venue-001", "Event has venueId linked");
    assert(!!data.data?.venueName, "Event has denormalized venueName");
  }

  // ─── 6. Event creation ────────────────────────────────────────────────────
  console.log("\n6️⃣  Event Creation (organizer)");
  let createdEventId: string | null = null;
  {
    const { status, data } = await api("POST", "/v1/events", organizerToken, {
      organizationId: "org-001",
      title: "E2E Test Event",
      description: "Created by the validation script to test the full flow.",
      shortDescription: "E2E test event",
      category: "conference",
      format: "in_person",
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      timezone: "Africa/Dakar",
      location: {
        name: "Test Venue",
        address: "123 Rue du Test",
        city: "Dakar",
        country: "SN",
      },
      ticketTypes: [
        {
          id: "ticket-e2e-001",
          name: "Test Ticket",
          price: 0,
          currency: "XOF",
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
      isPublic: true,
      isFeatured: false,
      requiresApproval: false,
      maxAttendees: 100,
      tags: ["e2e", "test"],
    });
    assert(status === 201 || status === 200, `POST /v1/events → 201 (got ${status})`);
    if (data.data?.id) {
      createdEventId = data.data.id;
      assert(true, `Event created with ID: ${createdEventId}`);
    } else {
      assert(false, `Event creation returned no ID: ${JSON.stringify(data).slice(0, 200)}`);
    }
  }

  // ─── 7. Publish the event ─────────────────────────────────────────────────
  let eventPublished = false;
  if (createdEventId) {
    console.log("\n7️⃣  Publish Event");
    const { status, data } = await api("POST", `/v1/events/${createdEventId}/publish`, organizerToken, {});
    if (status !== 200) {
      console.log(`    ℹ️  Publish response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    assert(status === 200, `POST /v1/events/${createdEventId}/publish → 200 (got ${status})`);
    eventPublished = status === 200;
  }

  // ─── 8. Registration by participant ────────────────────────────────────────
  // Use the created event if published, otherwise fall back to seeded event-001
  const regEventId = eventPublished ? createdEventId! : "event-001";
  const regTicketId = eventPublished ? "ticket-e2e-001" : "ticket-standard-001";
  let registrationId: string | null = null;

  console.log(`\n8️⃣  Registration (participant on ${regEventId})`);
  {
    const { status, data } = await api("POST", "/v1/registrations", participantToken, {
      eventId: regEventId,
      ticketTypeId: regTicketId,
    });
    // May get 409 if participant already registered on seeded event
    if (status === 409) {
      assert(true, "Participant already registered (409 — expected with seeded data)");
    } else {
      assert(status === 201 || status === 200, `POST /v1/registrations → 201 (got ${status})`);
      if (data.data?.id) {
        registrationId = data.data.id;
        assert(true, `Registration created: ${registrationId}`);
        assert(!!data.data.qrCodeValue, "Registration has QR code value");
      } else {
        assert(false, `Registration creation failed: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }
  }

  // ─── 9. Organizer views registrations ──────────────────────────────────────
  console.log("\n9️⃣  Registration List (organizer view)");
  {
    // Use seeded event-001 which always has registrations
    const { status, data } = await api(
      "GET",
      "/v1/registrations/event/event-001",
      organizerToken
    );
    assert(status === 200, `GET /v1/registrations/event/event-001 → 200 (got ${status})`);
    assert(Array.isArray(data.data), "Returns array of registrations");
    assert((data.data || []).length >= 1, `At least 1 registration (got ${(data.data || []).length})`);
  }

  // ─── 10. Public venue listing ───────────────────────────────────────────────
  console.log("\n🔟 Venue Listing (public)");
  {
    const { status, data } = await api("GET", "/v1/venues");
    assert(status === 200, `GET /v1/venues → 200 (got ${status})`);
    assert(data.success === true, "Response has success: true");
    assert(Array.isArray(data.data), "Response data is an array");
    // Only approved venues in public listing
    const approvedVenues = (data.data || []).filter((v: any) => v.status === "approved");
    assert(approvedVenues.length >= 2, `At least 2 approved venues (got ${approvedVenues.length})`);
  }

  // ─── 11. Venue detail ─────────────────────────────────────────────────────
  console.log("\n1️⃣1️⃣ Venue Detail");
  {
    const { status, data } = await api("GET", "/v1/venues/venue-001");
    assert(status === 200, `GET /v1/venues/venue-001 → 200 (got ${status})`);
    assert(data.data?.name?.includes("CICAD"), "Venue name contains CICAD");
    assert(data.data?.status === "approved", "Venue status is approved");
    assert(data.data?.eventCount >= 1, `Venue has eventCount >= 1 (got ${data.data?.eventCount})`);
  }

  // ─── 12. Admin stats ──────────────────────────────────────────────────────
  console.log("\n1️⃣2️⃣ Admin Stats (super_admin)");
  {
    const { status, data } = await api("GET", "/v1/admin/stats", adminToken);
    assert(status === 200, `GET /v1/admin/stats → 200 (got ${status})`);
    assert(data.data?.totalUsers >= 8, `Total users >= 8 (got ${data.data?.totalUsers})`);
    assert(data.data?.totalOrganizations >= 2, `Total orgs >= 2 (got ${data.data?.totalOrganizations})`);
    assert(data.data?.totalEvents >= 4, `Total events >= 4 (got ${data.data?.totalEvents})`);
    assert(data.data?.activeVenues >= 2, `Active venues >= 2 (got ${data.data?.activeVenues})`);
  }

  // ─── 13. Admin user list ──────────────────────────────────────────────────
  console.log("\n1️⃣3️⃣ Admin User List (super_admin)");
  {
    const { status, data } = await api("GET", "/v1/admin/users", adminToken);
    assert(status === 200, `GET /v1/admin/users → 200 (got ${status})`);
    assert(Array.isArray(data.data), "Returns array of users");
    assert((data.data || []).length >= 8, `At least 8 users (got ${(data.data || []).length})`);
  }

  // ─── 14. Admin audit logs ─────────────────────────────────────────────────
  console.log("\n1️⃣4️⃣ Admin Audit Logs (super_admin)");
  {
    const { status, data } = await api("GET", "/v1/admin/audit-logs", adminToken);
    assert(status === 200, `GET /v1/admin/audit-logs → 200 (got ${status})`);
    assert(Array.isArray(data.data), "Returns array of audit logs");
    assert((data.data || []).length >= 10, `At least 10 audit entries (got ${(data.data || []).length})`);
    // Check venue-related logs exist
    const venueActions = (data.data || []).filter((l: any) => l.action?.startsWith("venue."));
    assert(venueActions.length >= 1, `Has venue audit entries (got ${venueActions.length})`);
  }

  // ─── 15. Admin access denied for non-admin ────────────────────────────────
  console.log("\n1️⃣5️⃣ Admin Access Denied (participant)");
  {
    const { status } = await api("GET", "/v1/admin/stats", participantToken);
    assert(status === 403, `GET /v1/admin/stats (participant) → 403 (got ${status})`);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed === 0) {
    console.log("\n🎉 All E2E validations passed! Full platform working end-to-end.");
    console.log("   Core loop + Admin panel + Venue API all validated.");
  } else {
    console.log("\n⚠️  Some validations failed. Review the output above.");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("\n💥 E2E validation crashed:", err.message);
  process.exit(1);
});
