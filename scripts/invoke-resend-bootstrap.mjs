#!/usr/bin/env node
// Invoke the `bootstrapResendInfra` Cloud Function callable from CI,
// without ever running `firebase functions:call` on a human's laptop.
//
// Why this script exists
//   `bootstrapResendInfra` is a Firebase `onCall` function that checks
//   `request.auth.token.roles` includes "super_admin". That's a Firebase
//   Auth ID token, not a GCP IAM identity, so a plain service account
//   can't call it directly. We need to mint a Firebase Auth token with
//   the right custom claim before we can invoke.
//
// Flow
//   1. Firebase Admin SDK (auth via GOOGLE_APPLICATION_CREDENTIALS,
//      which the GitHub Actions `google-github-actions/auth` step
//      writes on the runner) upserts a dedicated CI user
//      (`ci-bootstrap-resend@svc.teranga`) with `roles: ["super_admin"]`
//      in custom claims. Upsert — safe to re-run.
//   2. Mint a Firebase custom token for that uid.
//   3. Exchange the custom token for an ID token via Identity Toolkit
//      (`accounts:signInWithCustomToken`) using the project's web API
//      key. The workflow fetches the key from Firebase before invoking.
//   4. POST the ID token to the callable's HTTPS endpoint with the
//      standard Firebase callable payload shape: `{ data: {} }`.
//   5. Print the response JSON.
//
// The CI user stays in Firebase Auth after the run — subsequent
// invocations reuse it (the upsert costs one `auth().getUser()` lookup).
// The super_admin claim is only usable via this SA-minted token flow;
// no password ever exists for the user.
//
// Usage
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   FIREBASE_PROJECT_ID=teranga-app-990a8 \
//   FIREBASE_API_KEY=AIza... \
//   FUNCTION_URL=https://europe-west1-teranga-app-990a8.cloudfunctions.net/bootstrapResendInfra \
//     node scripts/invoke-resend-bootstrap.mjs
//
// Exit codes
//   0  Bootstrap succeeded. Response JSON printed to stdout.
//   1  Any precondition missing, any Firebase/HTTP error.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = requireEnv("FIREBASE_PROJECT_ID");
const API_KEY = requireEnv("FIREBASE_API_KEY");
const FUNCTION_URL = requireEnv("FUNCTION_URL");

// Dedicated CI identity. Email is synthetic (no real inbox) — Firebase
// doesn't verify it for custom-token flows. The `svc.` subdomain makes
// its machine-only nature obvious in the Auth dashboard.
const CI_UID = "ci-bootstrap-resend";
const CI_EMAIL = "ci-bootstrap-resend@svc.teranga";
const CI_DISPLAY_NAME = "CI · Bootstrap Resend Infra";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`::error::Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
});

async function ensureCiUser() {
  const auth = getAuth();
  try {
    const existing = await auth.getUser(CI_UID);
    // Claims can drift if an operator manually edited the user; re-apply
    // on every run so the CI path is deterministic.
    if (!existing.customClaims?.roles?.includes?.("super_admin")) {
      await auth.setCustomUserClaims(CI_UID, { roles: ["super_admin"] });
      console.error(`  reset super_admin claim on existing CI user`);
    }
    return existing.uid;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const created = await auth.createUser({
    uid: CI_UID,
    email: CI_EMAIL,
    emailVerified: true,
    displayName: CI_DISPLAY_NAME,
    disabled: false,
  });
  await auth.setCustomUserClaims(created.uid, { roles: ["super_admin"] });
  console.error(`  created CI user ${CI_UID} with super_admin claim`);
  return created.uid;
}

async function mintIdToken(uid) {
  const auth = getAuth();
  const customToken = await auth.createCustomToken(uid, {
    // Mirror the claim into the custom-token payload so it flows into
    // the ID token the Identity Toolkit mints. Admin SDK reads custom
    // claims from the user record, so this is belt-and-braces.
    roles: ["super_admin"],
  });

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`signInWithCustomToken failed (HTTP ${res.status}): ${body}`);
  }
  const { idToken } = await res.json();
  if (!idToken) throw new Error("signInWithCustomToken returned no idToken");
  return idToken;
}

async function invokeCallable(idToken) {
  // Firebase callables expect { data: <payload> } and return { result } on
  // success or { error: { status, message } } on failure with HTTP 200+.
  // We use no payload — the callable reads RESEND_WEBHOOK_URL from its
  // own env vars.
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: {} }),
  });
  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }
  if (!res.ok || parsed.error) {
    console.error(`::error::Callable returned HTTP ${res.status}`);
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }
  return parsed.result ?? parsed;
}

try {
  console.error(`› Ensuring CI super_admin user`);
  const uid = await ensureCiUser();

  console.error(`› Minting Firebase ID token`);
  const idToken = await mintIdToken(uid);

  console.error(`› Invoking ${FUNCTION_URL}`);
  const result = await invokeCallable(idToken);

  console.error(`✓ Bootstrap complete`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
}
