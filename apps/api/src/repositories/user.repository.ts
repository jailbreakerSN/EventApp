import { COLLECTIONS, auth } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type UserProfile, type UserRole } from "@teranga/shared-types";

/**
 * Internal type that maps UserProfile's `uid` to `id` for Firestore compatibility.
 * BaseRepository requires `{ id: string }`, but UserProfile uses `uid`.
 * Documents are stored with both `id` and `uid` fields.
 */
type UserDoc = UserProfile & { id: string };

export class UserRepository extends BaseRepository<UserDoc> {
  constructor() {
    super(COLLECTIONS.USERS, "User");
  }

  async findByUid(uid: string): Promise<UserProfile | null> {
    return this.findById(uid);
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    return this.findOne([{ field: "email", op: "==", value: email }]);
  }

  async getFcmTokens(userIds: string[]): Promise<string[]> {
    const users = await this.batchGet(userIds);
    // Handle both legacy and new shapes transparently. Phase C.1
    // (see apps/api/src/services/fcm-tokens.service.ts) introduced
    // an object-shaped FcmToken ({ token, platform, ... }); legacy
    // users still have `string[]` until they re-register. The FCM
    // admin SDK only needs the raw token string, so extract it
    // either way. Without this guard, any user who has registered
    // via POST /v1/me/fcm-tokens would have their pushes fail —
    // sendEachForMulticast would receive objects and reject them.
    return users.flatMap((u) => {
      const raw = (u.fcmTokens ?? []) as unknown[];
      return raw.map((t) => (typeof t === "string" ? t : (t as { token: string }).token));
    });
  }

  /**
   * Find user by UID, or lazily create the Firestore profile from Firebase Auth data.
   * This handles cases where the Cloud Function onCreate trigger didn't fire
   * (e.g., functions emulator not running, or trigger failed silently).
   */
  async findOrCreateFromAuth(uid: string): Promise<UserProfile> {
    const existing = await this.findById(uid);
    if (existing) return existing;

    // Fetch user record from Firebase Auth
    const authUser = await auth.getUser(uid);

    const profileData = {
      uid,
      email: authUser.email ?? "",
      displayName: authUser.displayName ?? authUser.email?.split("@")[0] ?? "User",
      photoURL: authUser.photoURL ?? null,
      phone: authUser.phoneNumber ?? null,
      bio: null,
      roles: ["participant" as UserRole],
      organizationId: null,
      preferredLanguage: "fr" as const,
      fcmTokens: [],
      isEmailVerified: authUser.emailVerified ?? false,
      isActive: true,
    };

    return await this.createWithId(uid, profileData);
  }

  /**
   * @deprecated Since Phase C.1 (commit 422fd8b). Use FcmTokensService.register
   * instead — it runs inside a transaction, caps at 10 tokens (not 5),
   * persists the richer FcmToken shape ({ token, platform, userAgent?,
   * registeredAt, lastSeenAt }), emits audit events, and is idempotent.
   *
   * Kept only to avoid breaking the legacy POST /v1/users/me/fcm-token
   * route until its callers migrate. Accepts both the legacy string[] and
   * the new FcmToken[] stored shapes on read; writes back as string[], so
   * invoking this on a user who already registered via Phase C.1 will
   * lose their FcmToken metadata (platform, userAgent, timestamps).
   * When migrating the last caller, delete this method.
   */
  async addFcmToken(userId: string, token: string): Promise<void> {
    const user = await this.findByIdOrThrow(userId);
    const raw = (user.fcmTokens ?? []) as unknown[];
    const existing = raw.map((t) =>
      typeof t === "string" ? t : (t as { token: string }).token,
    );
    if (existing.includes(token)) return;

    await this.update(userId, {
      fcmTokens: [...existing, token].slice(-5), // max 5 devices
    } as Partial<UserDoc>);
  }
}

export const userRepository = new UserRepository();
