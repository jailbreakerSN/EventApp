import { eventRepository } from "@/repositories/event.repository";
import type { EventKeyResolver } from "./qr-signing";
import { deriveEventKey } from "./qr-signing";

// ─── v4 QR key resolver ─────────────────────────────────────────────────────
// Bridges `verifyQrPayload` (which is kept independent of the repository
// layer) with Firestore. Looks up the event, matches the inbound `kid`
// against the current `event.qrKid` OR any retired entry in
// `event.qrKidHistory`, then hands the caller a derived HMAC key.
//
// **Usage contract.** This function must only be invoked downstream of an
// authenticated request that has already passed permission + org-access
// checks (`checkin:scan`, etc.). It performs no auth of its own — a bare
// caller would happily derive a key for ANY event. The current call sites
// (`registration.service.ts:checkIn`, `checkin.service.ts:processCheckinItem`,
// `sponsor.service.ts:recordLead`) are all correctly gated; future callers
// must preserve that invariant.
//
// Fail-closed semantics:
//   - event doc missing      → null
//   - event doc has no kid   → null (event pre-v4 or kid cleared)
//   - kid doesn't match      → null (stale kid from a rolled-back rotation,
//                                     or tampered payload)
//
// `verifyQrPayload` treats any null return as a verification failure, so a
// v4 QR with an unknown kid never scans. That's the whole point of
// rotation.

export const resolveEventKeyFromEvent: EventKeyResolver = async (eventId: string, kid: string) => {
  const event = await eventRepository.findById(eventId).catch(() => null);
  if (!event) return null;

  const current = event.qrKid ?? null;
  const history = event.qrKidHistory ?? [];

  if (current === kid || history.some((h) => h.kid === kid)) {
    return deriveEventKey(eventId, kid);
  }
  return null;
};
