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
 */
export const onUserCreated = functionsV1
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .region("europe-west1")
  .auth.user()
  .onCreate(async (user) => {
    const now = new Date().toISOString();

    try {
      await db
        .collection(COLLECTIONS.USERS)
        .doc(user.uid)
        .set({
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
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
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
