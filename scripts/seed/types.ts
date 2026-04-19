/**
 * Shared types used across every seed module.
 *
 * The goal is to let each `01-…`, `02-…`, `N-…` module accept the same
 * `SeedContext` so the orchestrator can wire them up in a single place.
 * No module imports firebase-admin directly — it only ever receives the
 * already-initialised `db` + `auth` handles through this context.
 */

import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Everything a seed module needs to read / write against the chosen target.
 * The orchestrator constructs this once after `assertSafeTarget()` and
 * `initializeApp()` and passes it unchanged to every module in dependency
 * order.
 */
export interface SeedContext {
  db: Firestore;
  auth: Auth;
  /** Pretty label derived from `PROJECT_LABEL[PROJECT_ID]` for console lines. */
  projectLabel: string;
}

/**
 * Minimal shape returned by each seed module. The orchestrator uses the
 * `summary` fields to build the final "Seed complete!" console digest — so
 * every module that adds to a human-visible collection should contribute
 * one line here.
 */
export interface SeedModuleResult {
  name: string;
  created: number;
  skipped?: number;
  summary?: string;
}
