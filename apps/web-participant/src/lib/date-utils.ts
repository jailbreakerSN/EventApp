/**
 * Compute dateFrom/dateTo ISO strings from a date filter shortcut.
 * This is a plain utility (no "use client") so it can be used in both
 * server components and client components.
 */
export function getDateRange(dateFilter: string | undefined): { dateFrom?: string; dateTo?: string } {
  if (!dateFilter) return {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (dateFilter) {
    case "today":
      return {
        dateFrom: today.toISOString(),
        dateTo: new Date(today.getTime() + 86400000).toISOString(),
      };
    case "this_week": {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
      return { dateFrom: today.toISOString(), dateTo: endOfWeek.toISOString() };
    }
    case "this_month": {
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { dateFrom: today.toISOString(), dateTo: endOfMonth.toISOString() };
    }
    case "next_month": {
      const startNext = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const endNext = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      return { dateFrom: startNext.toISOString(), dateTo: endNext.toISOString() };
    }
    default:
      return {};
  }
}
