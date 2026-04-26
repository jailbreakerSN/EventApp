/**
 * Organizer overhaul — Phase O9.
 *
 * Pure helpers used by post-event components. Extracted from the JSX
 * layer so they can be unit-tested without booting the React + Query
 * + Firebase stack.
 */

/** Format a number as `1 234 567 XOF` (no decimals — XOF has none). */
export function formatXof(amount: number): string {
  // Manual thousands separation — the backoffice's `formatCurrency`
  // helper exists in shared-ui but routes XOF through Intl which
  // emits a narrow-no-break-space the PDF renderer can't ingest.
  // We keep this client-side in regular spaces for visual parity.
  const n = Math.max(0, Math.round(amount));
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} XOF`;
}

/** Pretty-print a payment method enum value. */
export function formatPaymentMethod(method: string): string {
  switch (method) {
    case "wave":
      return "Wave";
    case "orange_money":
      return "Orange Money";
    case "free_money":
      return "Free Money";
    case "mock":
      return "Mock (test)";
    default:
      return method;
  }
}

/** Pretty-print a payment status enum value. */
export function formatPaymentStatus(status: string): string {
  switch (status) {
    case "succeeded":
      return "Succès";
    case "failed":
      return "Échec";
    case "pending":
      return "En attente";
    case "refunded":
      return "Remboursé";
    default:
      return status;
  }
}
