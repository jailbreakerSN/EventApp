import { identity } from "firebase-functions/v2";
import { logger } from "firebase-functions/v2";
import { db, COLLECTIONS } from "../utils/admin";

/**
 * Auto-create a Firestore user profile when a new Firebase Auth user is created.
 * Uses Firebase Functions v2 identity triggers.
 */
export const onUserCreated = identity.beforeUserCreated(
  { region: "europe-west1" },
  async (event) => {
    const user = event.data;
    const now = new Date().toISOString();

    try {
      await db.collection(COLLECTIONS.USERS).doc(user.uid).set({
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

    return {};
  },
);

/**
 * Cleanup when user is deleted from Firebase Auth.
 * Soft-delete: mark as inactive to preserve event history.
 */
export const onUserDeleted = identity.beforeUserDeleted(
  { region: "europe-west1" },
  async (event) => {
    const user = event.data;

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

    return {};
  },
);
