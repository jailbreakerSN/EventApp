import { NotificationSettingSchema, type NotificationSetting } from "@teranga/shared-types";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";

// ─── Notification Settings Repository ──────────────────────────────────────
// Per-notification-key admin overrides. Doc id layout:
//   - platform-wide override: `{key}` (e.g. "registration.created")
//   - per-org override:       `{key}__{organizationId}`
//
// Absent doc means the dispatcher falls back to the next precedence step
// (per-org → platform → catalog default) — see
// apps/api/src/services/notifications/setting-resolution.ts.
//
// BaseRepository<T> assumes `T.id: string`; for this collection `id` is
// the composite doc id (key, or key__orgId). Callers address documents
// via findByKey / findByKeyAndOrg, never by raw id.

interface NotificationSettingDoc extends NotificationSetting {
  /** Mirror of the Firestore doc id — BaseRepository requires an `id` field. */
  id: string;
}

/**
 * Composite doc-id helper. Kept next to the repository so the id layout
 * has a single source of truth (migrations, tests, admin scripts).
 */
export function notificationSettingDocId(key: string, organizationId: string | null): string {
  return organizationId ? `${key}__${organizationId}` : key;
}

export class NotificationSettingsRepository extends BaseRepository<NotificationSettingDoc> {
  constructor() {
    super(COLLECTIONS.NOTIFICATION_SETTINGS, "NotificationSetting");
  }

  /**
   * Return the platform-wide override for a given notification key, or
   * null when the admin has never touched it. The dispatcher treats null
   * as "use catalog defaults" (see docs/notification-system-architecture.md
   * §7 step 2).
   */
  async findByKey(key: string): Promise<NotificationSetting | null> {
    return this.readParsed(notificationSettingDocId(key, null), key, null);
  }

  /**
   * Phase 2.4 — per-org override for a given notification key. Used by
   * the setting-resolution helper to implement the per-org → platform →
   * catalog precedence chain. Null when no override exists for the pair.
   */
  async findByKeyAndOrg(
    key: string,
    organizationId: string,
  ): Promise<NotificationSetting | null> {
    return this.readParsed(notificationSettingDocId(key, organizationId), key, organizationId);
  }

  /**
   * List every per-org override for a single organization. Bounded by
   * the catalog size so no pagination.
   */
  async findAllForOrg(organizationId: string): Promise<NotificationSetting[]> {
    const snap = await this.collection.where("organizationId", "==", organizationId).get();
    const out: NotificationSetting[] = [];
    for (const doc of snap.docs) {
      const parsed = this.parseFirestoreDoc(doc.id, doc.data());
      if (parsed) out.push(parsed);
    }
    return out;
  }

  /**
   * Upsert the override for a key (platform-wide or per-org depending on
   * setting.organizationId). Always writes the full document so a partial
   * payload never leaves the collection in a mixed state. Callers
   * (super-admin + organizer APIs) are responsible for enforcing
   * permissions and emitting audit events.
   */
  async upsert(setting: NotificationSetting): Promise<void> {
    const orgId = setting.organizationId ?? null;
    const id = notificationSettingDocId(setting.key, orgId);
    await this.collection.doc(id).set(
      {
        id,
        key: setting.key,
        organizationId: orgId,
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
   * List every stored platform-wide override (organizationId null/missing).
   * Used by the super-admin UI list view, merged with the full catalog in
   * memory. Bounded by the catalog size (~30 entries in v1).
   */
  async listAll(): Promise<NotificationSetting[]> {
    const snap = await this.collection.get();
    const out: NotificationSetting[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      // Back-compat — pre-Phase-2.4 docs have no organizationId field.
      // Treat those as platform-wide.
      const orgId = (data.organizationId as string | null | undefined) ?? null;
      if (orgId !== null) continue;
      const parsed = this.parseFirestoreDoc(doc.id, data);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  /**
   * List every stored per-org override across all organizations. Used by
   * the super-admin "Per-org overrides" tab to surface orgs that have
   * customised a notification.
   */
  async listAllPerOrg(): Promise<NotificationSetting[]> {
    const snap = await this.collection.where("organizationId", "!=", null).get();
    const out: NotificationSetting[] = [];
    for (const doc of snap.docs) {
      const parsed = this.parseFirestoreDoc(doc.id, doc.data());
      if (parsed && parsed.organizationId) out.push(parsed);
    }
    return out;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async readParsed(
    docId: string,
    key: string,
    organizationId: string | null,
  ): Promise<NotificationSetting | null> {
    const doc = await this.collection.doc(docId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data) return null;
    return this.parseFirestoreDoc(docId, data, { key, organizationId });
  }

  private parseFirestoreDoc(
    docId: string,
    data: Record<string, unknown>,
    hint?: { key: string; organizationId: string | null },
  ): NotificationSetting | null {
    // Derive key + organizationId from the doc id when the repository
    // doesn't know them up front (listAll, listAllPerOrg). Split on the
    // first `__` so a key can never be ambiguous (notification keys use
    // dot-prefixes, never double-underscore).
    let key = hint?.key;
    let organizationId = hint?.organizationId ?? null;
    if (!key) {
      const idx = docId.indexOf("__");
      if (idx > 0) {
        key = docId.slice(0, idx);
        organizationId = docId.slice(idx + 2);
      } else {
        key = docId;
        organizationId = (data.organizationId as string | null | undefined) ?? null;
      }
    }

    // Fail open on `enabled` missing (see Phase 1 security review P1-2).
    // Any OTHER shape violation falls back to "no override".
    const candidate = {
      key,
      organizationId,
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
          docId,
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}:${i.code}`),
        }) + "\n",
      );
      return null;
    }
    return parsed.data;
  }
}

export const notificationSettingsRepository = new NotificationSettingsRepository();
