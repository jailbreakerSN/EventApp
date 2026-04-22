import { logger } from "firebase-functions/v2";
import { dispatchInternalChunked } from "../utils/internal-dispatch";

// ─── Certificate issuance helper (Phase 2.3) ───────────────────────────────
//
// Unlike the other Phase 2.3 triggers, this file is NOT a scheduled job —
// it's a thin callable helper used by the API when an organizer clicks
// "Issue certificates" in the back-office. The API service layer calls
// `onCertificatesIssued(...)` which:
//
//   1. Fans out the `certificate.ready` notification (email only in v1)
//      to every user id listed in the payload via the internal dispatch
//      endpoint.
//   2. Returns `{ sent, failed }` so the caller can surface the outcome
//      in the back-office response.
//
// No Firestore writes, no domain-event emission here — the API is
// responsible for both (the domain event `event.certificates_issued` is
// emitted inside the API's certificate service, which is also where
// the dispatcher listener subscribes). This file exists in the
// Functions workspace so the same egress posture (shared secret + VPC
// allow-list) applies whether the caller is a scheduled job or an API
// service method running inside Cloud Run.
//
// NOTE — Phase 2.3 keeps the API-side emitter as the canonical path.
// This wrapper is surfaced for any future Cloud Function that wants to
// fan out certificate emails directly (e.g. a scheduled "auto-issue 24h
// after event end" job in a later phase). Today the API service uses
// the notification dispatcher directly — see
// apps/api/src/events/listeners/notification-dispatcher.listener.ts
// (`registerCertificateListeners`).

export interface CertificateReadyPayload {
  eventId: string;
  eventTitle: string;
  /** Pre-formatted end date, e.g. "22 avril 2026". */
  eventDate: string;
  userIds: string[];
  /** Optional download-link validity hint surfaced to the recipient. */
  validityHint?: string;
  /** Optional slug for deep links; falls back to eventId in the URL. */
  eventSlug?: string;
}

export async function onCertificatesIssued(
  payload: CertificateReadyPayload,
): Promise<{ sent: number; failed: number }> {
  if (payload.userIds.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Per-user dispatch — lets the dispatcher apply its opt-out + dedup
  // logic independently for each recipient, and produces one audit log
  // row per user so the admin UI can show per-participant delivery
  // status on the certificate run.
  let sent = 0;
  let failed = 0;

  for (const userId of payload.userIds) {
    const result = await dispatchInternalChunked({
      key: "certificate.ready",
      recipients: [{ userId }],
      params: {
        eventTitle: payload.eventTitle,
        eventDate: payload.eventDate,
        certificateUrl: `/events/${payload.eventSlug ?? payload.eventId}/certificate`,
        validityHint: payload.validityHint,
      },
      idempotencyKey: `certificate-ready/${payload.eventId}/${userId}`,
    });
    sent += result.sent;
    failed += result.failed;
  }

  logger.info("certificate.ready dispatched", {
    eventId: payload.eventId,
    recipients: payload.userIds.length,
    sent,
    failed,
  });

  return { sent, failed };
}
