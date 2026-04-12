/**
 * Maps common status strings to Badge component variant names.
 * Used to standardize status badge colors across the platform.
 */

const STATUS_VARIANT_MAP: Record<string, string> = {
  published: "success",
  confirmed: "success",
  active: "success",
  approved: "success",
  sent: "success",
  accepted: "success",
  completed: "info",
  checked_in: "premium",
  draft: "neutral",
  archived: "neutral",
  expired: "neutral",
  cancelled: "destructive",
  failed: "destructive",
  rejected: "destructive",
  declined: "destructive",
  suspended: "destructive",
  payment_failed: "destructive",
  pending: "pending",
  processing: "pending",
  waitlisted: "pending",
  pending_payment: "pending",
  trialing: "info",
};

/**
 * Returns the Badge variant for a given status string.
 * Falls back to "default" if the status is not recognized.
 */
export function getStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "pending" | "neutral" | "premium" {
  return (STATUS_VARIANT_MAP[status] ?? "default") as ReturnType<typeof getStatusVariant>;
}
