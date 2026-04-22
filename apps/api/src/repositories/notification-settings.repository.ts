import { NotificationSettingSchema, type NotificationSetting } from "@teranga/shared-types";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";

// ─── Notification Settings Repository ──────────────────────────────────────
// Per-notification-key admin overrides. Doc id = notification key
// (e.g. "registration.created"). Absent doc means the dispatcher falls
// back to the NotificationDefinition's `defaultChannels` with
// `enabled: true` — see apps/api/src/services/notification.service.ts §7.
//
// BaseRepository<T> assumes `T.id: string`; NotificationSetting's PK is
// `key`, which matches the doc id. The repo surfaces `findByKey` as a
// thin alias over `findById` so call sites read naturally at the service
// layer.

interface NotificationSettingDoc extends NotificationSetting {
  /** Mirror of `key` — BaseRepository requires an `id` field. */
  id: string;
}

export class NotificationSettingsRepository extends BaseRepository<NotificationSettingDoc> {
  constructor() {
    super(COLLECTIONS.NOTIFICATION_SETTINGS, "NotificationSetting");
  }

  /**
   * Return the admin override for a given notification key, or null when
   * the admin has never touched it. The dispatcher treats null as "use
   * catalog defaults" (see docs/notification-system-architecture.md §7
   * step 2).
   */
  async findByKey(key: string): Promise<NotificationSetting | null> {
    const doc = await this.collection.doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data) return null;

    // Validate the Firestore payload before the dispatcher trusts it.
    // A partially-migrated doc missing `enabled` is treated as "enabled"
    // (fail open — silently disabling all sends because a field is absent
    // would be worse); any OTHER shape violation (wrong type on `enabled`,
    // unknown channel values, missing audit fields) is treated as "no
    // override" so the dispatcher falls back to the catalog default.
    // Addresses the Phase 1 security review P1-2 finding.
    const candidate = {
      key,
      enabled: data.enabled ?? true,
      channels: data.channels ?? [],
      subjectOverride: data.subjectOverride,
      updatedAt: data.updatedAt,
      updatedBy: data.updatedBy,
    };
    const parsed = NotificationSettingSchema.safeParse(candidate);
    if (!parsed.success) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "notificationSettings.invalid_doc",
          key,
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}:${i.code}`),
        }) + "\n",
      );
      return null;
    }
    return parsed.data;
  }

  /**
   * Upsert the override for a key. Always writes the full document so a
   * partial payload never leaves the collection in a mixed state. The
   * caller (super-admin API, Phase 4) is responsible for enforcing
   * `platform:manage` and emitting `notification.setting_updated`.
   */
  async upsert(setting: NotificationSetting): Promise<void> {
    await this.collection.doc(setting.key).set(
      {
        id: setting.key,
        key: setting.key,
        enabled: setting.enabled,
        channels: setting.channels,
        ...(setting.subjectOverride ? { subjectOverride: setting.subjectOverride } : {}),
        updatedAt: setting.updatedAt,
        updatedBy: setting.updatedBy,
      },
      { merge: false },
    );
  }

  /**
   * List every stored override. Used by the super-admin UI list view,
   * merged with the full catalog in memory. The collection is bounded
   * by the catalog size (~10-50 entries in v1) so no pagination needed.
   */
  async listAll(): Promise<NotificationSetting[]> {
    const snap = await this.collection.get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        key: d.id,
        enabled: data.enabled ?? true,
        channels: data.channels ?? [],
        subjectOverride: data.subjectOverride,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      };
    });
  }
}

export const notificationSettingsRepository = new NotificationSettingsRepository();
