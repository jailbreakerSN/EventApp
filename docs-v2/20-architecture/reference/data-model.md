# Data Model — Firestore Collections

> **Status: shipped** — All collections listed here are implemented. See also [99-reference/collections.md](../../99-reference/collections.md) for a quick-lookup index.

All document IDs are Firestore auto-generated. The ID is also stored inside the document as an `id` field for convenience. All timestamps are ISO 8601 strings (not Firestore Timestamps) for consistent serialization.

---

## organizations

Owns everything: events, members, subscriptions.

```typescript
{
  id: string;
  name: string;
  slug: string;                    // immutable after creation
  ownerId: string;                 // uid of the Firebase Auth user who created the org
  memberIds: string[];             // uids of all members (includes owner)
  plan: OrganizationPlan;          // 'free' | 'starter' | 'pro' | 'enterprise' (legacy)
  isVerified: boolean;             // KYB verified by super-admin
  isActive: boolean;               // false = suspended
  // Phase 2+ denormalized plan cache:
  effectiveLimits?: { maxEvents: number; maxParticipantsPerEvent: number; maxMembers: number; };
  effectiveFeatures?: PlanFeatures;
  effectivePlanKey?: string;
  effectiveComputedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## users

One document per Firebase Auth user.

```typescript
{
  uid: string;                     // = Firebase Auth UID
  email: string;
  displayName: string;
  photoURL: string | null;
  phone: string | null;
  bio: string | null;
  roles: SystemRole[];             // ['participant', 'organizer', ...]
  organizationId: string | null;   // null for pure participants
  orgRole: OrgMemberRole | null;   // 'owner' | 'admin' | 'member' | 'viewer'
  preferredLanguage: 'fr' | 'en' | 'wo';
  fcmTokens: string[];             // push notification device tokens
  isEmailVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## events

```typescript
{
  id: string;
  organizationId: string;          // immutable
  title: string;
  slug: string;                    // immutable, URL-safe
  description: string;
  category: EventCategory;         // 'conference' | 'workshop' | 'concert' | 'festival' | 'sport' | 'networking' | 'other'
  tags: string[];
  format: 'in_person' | 'online' | 'hybrid';
  status: EventStatus;             // 'draft' | 'published' | 'cancelled' | 'completed' | 'archived'
  location: {
    name: string;
    address: string;
    city: string;
    country: string;
    coordinates: { lat: number; lng: number } | null;
    streamUrl: string | null;
  };
  startDate: string;               // ISO 8601
  endDate: string;
  timezone: string;                // IANA timezone, e.g. 'Africa/Dakar'
  ticketTypes: TicketType[];       // embedded array
  accessZones: AccessZone[];       // embedded array
  registeredCount: number;         // denormalized counter
  checkedInCount: number;          // denormalized counter
  maxAttendees: number | null;
  isPublic: boolean;
  isFeatured: boolean;
  venueId: string | null;
  venueName: string | null;        // denormalized
  requiresApproval: boolean;       // if true, registrations go to waitlist first
  scanPolicy: ScanPolicy;          // 'single' | 'multi_day' | 'multi_zone'
  qrKid: string;                   // immutable — current QR signing key id
  qrKidHistory: { kid: string; retiredAt: string }[];  // immutable entries
  createdBy: string;               // immutable
  updatedBy: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

**Embedded types:**

```typescript
interface TicketType {
  id: string;
  name: string;
  price: number;                   // XOF, 0 = free
  totalQuantity: number | null;    // null = unlimited
  soldCount: number;
  saleStartDate: string | null;
  saleEndDate: string | null;
  isActive: boolean;
}

interface AccessZone {
  id: string;
  name: string;
  color: string;                   // hex color for UI
  allowedTicketTypeIds: string[];
  capacity: number | null;
  currentOccupancy: number;        // denormalized
}
```

---

## registrations

```typescript
{
  id: string;
  eventId: string;
  userId: string;                  // immutable
  ticketTypeId: string;
  status: RegistrationStatus;      // 'pending' | 'pending_payment' | 'confirmed' | 'waitlisted' | 'cancelled' | 'checked_in'
  qrCodeValue: string;             // signed QR string (v3 or v4)
  checkedInAt: string | null;
  checkedInBy: string | null;      // uid of staff member
  checkedInDeviceId: string | null;
  accessZoneId: string | null;
  // Denormalized for display (copied at registration time):
  participantName: string;
  participantEmail: string;
  eventTitle: string;
  eventSlug: string;
  eventStartDate: string;
  eventEndDate: string;
  ticketTypeName: string;
  promotedFromWaitlistAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

---

## badges

```typescript
{
  id: string;
  registrationId: string;
  eventId: string;
  userId: string;
  templateId: string | null;       // null = default template
  pdfUrl: string | null;           // Cloud Storage URL, set after generation
  signedQrCodeValue: string;
  notBefore: string;               // ISO 8601
  notAfter: string;
  status: 'pending' | 'generated' | 'sent' | 'failed';
  generatedAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
}
```

---

## sessions

Event agenda items.

```typescript
{
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  speakerIds: string[];
  location: string | null;         // room or stage name
  startTime: string;               // ISO 8601
  endTime: string;
  tags: string[];
  streamUrl: string | null;
  isBookmarkable: boolean;
  deletedAt: string | null;        // soft delete
  createdAt: string;
  updatedAt: string;
}
```

---

## subscriptions

```typescript
{
  id: string;
  organizationId: string;
  plan: OrganizationPlan;
  status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  paymentMethod: 'wave' | 'orange_money' | 'free_money' | 'card' | 'mock' | null;
  priceXof: number;
  billingCycle: 'monthly' | 'annual';
  planId: string | null;           // reference to plans/{id} (Phase 3+)
  overrides: {                     // super-admin per-org custom limits (Phase 5+)
    maxEvents?: number;
    maxParticipantsPerEvent?: number;
    maxMembers?: number;
    features?: Partial<PlanFeatures>;
  } | null;
  scheduledChange: {               // queued downgrade (Phase 4c)
    planKey: string;
    effectiveAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}
```

---

## plans

Super-admin managed plan catalog (Phase 2+).

```typescript
{
  id: string;                      // 'free' | 'starter' | 'pro' | 'enterprise' | custom
  key: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  priceXof: number;
  pricingModel: 'free' | 'fixed' | 'custom' | 'metered';
  limits: {
    maxEvents: number;             // -1 = unlimited
    maxParticipantsPerEvent: number;
    maxMembers: number;
  };
  features: PlanFeatures;          // all 11 boolean flags
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## payments

```typescript
{
  id: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  userId: string;
  amount: number;                  // XOF integer
  currency: 'XOF';
  method: PaymentMethod;           // 'wave' | 'orange_money' | 'free_money' | 'card' | 'mock'
  providerTransactionId: string | null;
  status: PaymentStatus;           // 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'expired'
  redirectUrl: string | null;      // Wave/OM USSD redirect
  callbackUrl: string;             // provider webhook target
  returnUrl: string;               // browser return after payment
  providerMetadata: Record<string, unknown> | null;
  failureReason: string | null;
  refundedAmount: number;
  initiatedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

---

## audit_logs

```typescript
{
  id: string;
  action: AuditAction;             // one of 83 enum values
  actorId: string;                 // uid of the user who triggered the action
  requestId: string;               // from AsyncLocalStorage request context
  timestamp: string;               // ISO 8601
  resourceType: string;
  resourceId: string;
  eventId: string | null;
  organizationId: string | null;
  details: Record<string, unknown>;
}
```

---

## offline_sync

Cached snapshot for staff devices. TTL is `event.endDate + 24h`.

```typescript
{
  eventId: string;
  organizationId: string;
  eventTitle: string;
  syncedAt: string;
  ttlAt: string;
  totalRegistrations: number;
  registrations: {
    registrationId: string;
    participantName: string;
    participantEmail: string;
    ticketTypeName: string;
    qrCodeValue: string;
    allowedZoneIds: string[];
  }[];
  accessZones: AccessZone[];
  ticketTypes: TicketType[];
}
```

---

## Other collections

| Collection | Key fields | Notes |
|---|---|---|
| `venues` | id, name, address, city, hostOrganizationId, status (pending/approved/suspended), capacity | Requires super-admin approval before use |
| `speakers` | id, eventId, userId, name, bio, photoURL, sessions[] | One per speaker per event |
| `sponsors` | id, eventId, organizationId, name, tier, logoUrl, boothUrl, leads[] | Tier: platinum/gold/silver/bronze |
| `feed_posts` | id, eventId, authorId, content, isPinned, comments[], type (announcement/update/general) | Soft-delete via deletedAt |
| `conversations` | id, participantIds[], eventId, lastMessage, unreadCount | 1:1 participant messaging |
| `notifications` | id, userId, type, title, body, data, isRead, createdAt | Per-user inbox |
| `promo_codes` | id, eventId, code, discount (flat/percent), usageLimit, currentUsageCount, expiresAt | Gated by promoCodes feature |
| `balance_transactions` | id, organizationId, type (payment/fee/refund/payout), amount, status, relatedPaymentId | Ledger entries |
| `payouts` | id, organizationId, period, gross, fees, net, status, requestedAt | Payout requests |
| `invite_tokens` | id, organizationId, email, role, token (HMAC-signed), expiresAt, status | Org member invitations |
