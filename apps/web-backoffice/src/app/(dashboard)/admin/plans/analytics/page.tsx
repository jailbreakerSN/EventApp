import { AdminPlanDashboard } from "./AdminPlanDashboard";

/**
 * Phase 7+ item #5 — MRR / cohort dashboard route shell.
 *
 * Server component (default). The real rendering + data-fetching lives in
 * the client component so React Query can manage refresh + stale time.
 * This shell only provides the heading / breadcrumb scaffolding.
 */
export default function AdminPlanAnalyticsPage() {
  return <AdminPlanDashboard />;
}
