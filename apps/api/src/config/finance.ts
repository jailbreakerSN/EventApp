// ─── Finance Config ─────────────────────────────────────────────────────────
//
// Centralised finance constants. Previously PLATFORM_FEE_RATE lived on
// payout.service.ts alone; the ledger (balance_transactions) needs the same
// value at payment.succeeded time to write the platform_fee entry, so we
// hoist it here to avoid drift between payment-time and payout-time fee
// calculations.

/**
 * Platform commission rate applied to every paid ticket. Deducted at
 * payment-succeeded time and recorded as a `platform_fee` ledger entry.
 * Stored as a decimal (0.05 = 5%). Override via env for regional pricing.
 */
export const PLATFORM_FEE_RATE = Number(process.env.PLATFORM_FEE_RATE ?? "0.05");

/**
 * T+N release window: number of days between an event's end date and the
 * date when payment funds graduate from `pending` to `available` in the
 * ledger. Matches the industry norm (Stripe defaults T+2 to T+7 depending on
 * country; African mobile-money rails typically T+1 to T+3). Kept generous
 * at 7 days to absorb dispute/chargeback windows — tighten later.
 *
 * Events without an `endDate` (rare; legacy data) fall back to T+N from the
 * payment date itself.
 */
export const FUNDS_RELEASE_DAYS = Number(process.env.FUNDS_RELEASE_DAYS ?? "7");

/**
 * Compute the net (after-fee) portion of a gross payment amount. Rounding
 * policy: round fee UP so the platform never undercollects, and org always
 * sees a slightly smaller net than the naïve (1 - rate) × gross. Matches
 * Stripe's rounding direction.
 */
export function computePlatformFee(grossAmountXof: number): number {
  return Math.round(grossAmountXof * PLATFORM_FEE_RATE);
}

/**
 * Compute the ISO timestamp at which funds from a payment become
 * `available` in the ledger. Preference order:
 *   1. eventEndDate + FUNDS_RELEASE_DAYS — funds unlock after the event
 *      has fully concluded (prevents early withdrawal before refund risk
 *      window closes).
 *   2. paymentCompletedAt + FUNDS_RELEASE_DAYS — fallback when the event
 *      date is unavailable at write time.
 */
export function computeAvailableOn(
  paymentCompletedAt: string,
  eventEndDate: string | null | undefined,
): string {
  const anchor = eventEndDate ?? paymentCompletedAt;
  const anchorMs = new Date(anchor).getTime();
  const releaseMs = anchorMs + FUNDS_RELEASE_DAYS * 86_400_000;
  return new Date(releaseMs).toISOString();
}
