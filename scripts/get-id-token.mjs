#!/usr/bin/env node
/**
 * Get a Firebase ID token for a seeded staging user.
 *
 * Usage:
 *   node scripts/get-id-token.mjs [email] [password]
 *
 * Defaults: organizer@teranga.dev / password123
 *
 * Example:
 *   TOKEN=$(node scripts/get-id-token.mjs)
 *   curl -H "Authorization: Bearer $TOKEN" \
 *     https://teranga-api-staging-784468934140.europe-west1.run.app/v1/organizations/org-001
 */

const FIREBASE_API_KEY = "AIzaSyBq_HtTysOank3j9X6QROE9oPUKyHZyTFw";
const email = process.argv[2] ?? "organizer@teranga.dev";
const password = process.argv[3] ?? "password123";

const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});

if (!res.ok) {
  const err = await res.text();
  console.error(`Sign-in failed (HTTP ${res.status}): ${err}`);
  process.exit(1);
}

const { idToken, expiresIn, localId } = await res.json();
// Only the token to stdout, so it can be piped into shell vars
process.stdout.write(idToken);
// Metadata to stderr for information
console.error(`\n✓ Signed in as ${email} (uid=${localId})`);
console.error(`  Token expires in ${expiresIn}s (~${Math.round(expiresIn / 60)}m)`);
