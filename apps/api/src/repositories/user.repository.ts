import { COLLECTIONS, auth } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import { type UserProfile } from "@teranga/shared-types";

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
    return users.flatMap((u) => u.fcmTokens ?? []);
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
      roles: ["participant"],
      organizationId: null,
      preferredLanguage: "fr",
      fcmTokens: [],
      isEmailVerified: authUser.emailVerified ?? false,
      isActive: true,
    };

    return await this.createWithId(uid, profileData);
  }

  async addFcmToken(userId: string, token: string): Promise<void> {
    const user = await this.findByIdOrThrow(userId);
    const existing: string[] = user.fcmTokens ?? [];
    if (existing.includes(token)) return;

    await this.update(userId, {
      fcmTokens: [...existing, token].slice(-5), // max 5 devices
    } as Partial<UserDoc>);
  }
}

export const userRepository = new UserRepository();
