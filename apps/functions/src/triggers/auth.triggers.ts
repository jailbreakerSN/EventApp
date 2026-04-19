import * as functionsV1 from "firebase-functions/v1";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";

/**
 * Auto-create a Firestore user profile when a new Firebase Auth user is created.
 *
 * Uses the v1 auth trigger rather than v2 `beforeUserCreated` because:
 *   - v2 blocking triggers require Identity Platform (paid tier of Firebase Auth).
 *   - We don't need to veto or mutate the user creation — we just want to
 *     mirror it into Firestore after the fact.
 *   - v1 onCreate runs after user creation and is available on all Firebase
 *     projects with standard Authentication enabled.
 *
 * Race condition fix (2026-04-15): the previous implementation used
 * `.set({...}, )` with a hardcoded `roles: ["participant"]`, which clobbered
 * any profile a caller had already written directly. That surfaced as a
 * visible bug in the admin users table — seeded users whose profile was
 * written with `roles: ["organizer"]` (seed-emulators.ts:490) were racing
 * the trigger, which then reset them to participant. Same class of bug
 * would bite production retries and any flow that creates the Auth user
 * and the Firestore profile in two writes.
 *
 * The fix: skip the write entirely when a profile already exists. Role
 * assignment in that case is the writer's responsibility (seed script,
 * admin console, or an explicit welcome flow). A fresh Firebase Auth user
 * with no Firestore profile still gets the default `participant` row so
 * sign-ups outside our provisioning pipeline don't land in a broken state.
 *
 * Custom claims from Firebase Auth are NOT read here because `onCreate`
 * runs before any `setCustomUserClaims` call in most flows — the caller
 * sets claims after `createUser` resolves. We stay consistent with the
 * existing contract: the Firestore doc is the source of truth for `roles`,
 * the Auth custom claims are a denormalised mirror written by
 * `adminService.updateUserRoles()` / `inviteService.acceptInvite()`.
 */
export const onUserCreated = functionsV1
  // maxInstances caps dev/staging cost if the Auth event loop misbehaves —
  // v1 setGlobalOptions doesn't apply so we declare it inline. Bump before prod.
  .runWith({ memory: "256MB", timeoutSeconds: 60, maxInstances: 2 })
  .region("europe-west1")
  .auth.user()
  .onCreate(async (user) => {
    const now = new Date().toISOString();
    const docRef = db.collection(COLLECTIONS.USERS).doc(user.uid);

    try {
      // Idempotency guard: if a profile already exists (seed script,
      // previous invocation, admin pre-provisioning), DON'T overwrite. The
      // existing doc is authoritative — honouring the roles the caller
      // wrote is the whole point of the fix.
      const existing = await docRef.get();
      if (existing.exists) {
        logger.info(`User profile already exists for ${user.uid}, skipping default creation`);
        return;
      }

      await docRef.set({
        uid: user.uid,
        email: user.email ?? "",
        displayName: user.displayName ?? user.email?.split("@")[0] ?? "User",
        photoURL: user.photoURL ?? null,
        phone: user.phoneNumber ?? null,
        bio: null,
        roles: ["participant"],
        organizationId: null,
        preferredLanguage: "fr",
        fcmTokens: [],
        isEmailVerified: user.emailVerified ?? false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      logger.info(`User profile created for ${user.uid}`);
    } catch (err) {
      logger.error(`Failed to create user profile for ${user.uid}`, err);
      // Don't block user creation — profile can be created lazily
    }
  });

/**
 * Cleanup when user is deleted from Firebase Auth.
 * Soft-delete: mark as inactive to preserve event history.
 * Uses v1 auth trigger (v2 identity module does not support user deletion events).
 */
export const onUserDeleted = functionsV1
  // maxInstances caps dev/staging cost if the Auth event loop misbehaves —
  // v1 setGlobalOptions doesn't apply so we declare it inline. Bump before prod.
  .runWith({ memory: "256MB", timeoutSeconds: 60, maxInstances: 2 })
  .region("europe-west1")
  .auth.user()
  .onDelete(async (user) => {
    try {
      const docRef = db.collection(COLLECTIONS.USERS).doc(user.uid);
      const doc = await docRef.get();

      if (doc.exists) {
        await docRef.update({
          isActive: false,
          fcmTokens: [], // clear push tokens
          updatedAt: new Date().toISOString(),
        });
        logger.info(`User ${user.uid} marked as inactive`);
      }
    } catch (err) {
      logger.error(`Failed to deactivate user ${user.uid}`, err);
    }
  });
