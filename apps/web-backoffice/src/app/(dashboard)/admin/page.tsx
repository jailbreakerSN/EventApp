import { redirect } from "next/navigation";

/**
 * Phase 1 — /admin root redirects to the task-oriented inbox landing.
 *
 * Rationale: the historical /admin page was a read-only stats dashboard
 * (now at /admin/overview). SaaS admin best practice is to land on a
 * "what needs my attention" view so an operator immediately knows
 * whether action is required — which is the job the inbox does.
 * Operators who want the stats dashboard still get it at /admin/overview.
 */
export default function AdminIndexPage() {
  redirect("/admin/inbox");
}
