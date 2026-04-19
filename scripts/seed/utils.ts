/**
 * Tiny helpers shared by seed modules.
 *
 * Kept deliberately small — everything here is mechanical plumbing (auth
 * user upsert, slugify, deterministic picker). Anything domain-specific
 * (city list, plan limits, category palette) lives in `config.ts` or in
 * the module it belongs to so unrelated modules don't share accidental
 * coupling through a giant utils grab-bag.
 */

import type { Auth } from "firebase-admin/auth";

/**
 * Create or refresh a Firebase Auth user. Idempotent — safe to re-run
 * after the user already exists.
 *
 * On a fresh emulator this hits `auth.createUser`. On re-seed (or after a
 * reset that missed an individual user) it falls through the expected
 * "uid already exists" error path and instead refreshes the displayName
 * in case the fixture changed. Custom claims are always re-applied so
 * role changes in the fixture reach the user on the next re-seed.
 */
export async function ensureUser(
  auth: Auth,
  uid: string,
  props: {
    email: string;
    password: string;
    displayName: string;
    phoneNumber?: string;
  },
  claims: Record<string, unknown>,
): Promise<void> {
  try {
    await auth.createUser({ uid, ...props, emailVerified: true });
  } catch (err: unknown) {
    const code = (err as { errorInfo?: { code?: string } })?.errorInfo?.code;
    if (code !== "auth/uid-already-exists") throw err;
    await auth.updateUser(uid, { displayName: props.displayName });
  }
  await auth.setCustomUserClaims(uid, claims);
}

/**
 * Slugify a title for use as a Firestore document slug. Lowercase,
 * accent-stripped, punctuation collapsed to single dashes.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic picker — returns `items[seed % items.length]`. Lets seed
 * modules build pseudo-random but reproducible data (e.g. "assign this
 * user to the Nth category") without introducing an RNG dependency.
 */
export function pick<T>(items: readonly T[], seed: number): T {
  if (items.length === 0) {
    throw new Error("pick() called with empty array");
  }
  const idx = ((seed % items.length) + items.length) % items.length;
  return items[idx] as T;
}

/**
 * Pad a number with leading zeros — used to build stable IDs like
 * `event-007`, `user-042`, `reg-012`.
 */
export function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}
