import {
  NOTIFICATION_CATALOG_BY_KEY,
  type NotificationChannel,
  type NotificationDefinition,
  type NotificationSetting,
} from "@teranga/shared-types";
import { notificationSettingsRepository } from "@/repositories/notification-settings.repository";

// ─── Notification Setting Resolution ───────────────────────────────────────
// Phase 2.4 — helper that returns the effective notification config for a
// given (key, organizationId) pair. Precedence (highest → lowest):
//
//   1. Per-organization override (notificationSettings/{key}__{orgId})
//   2. Platform override        (notificationSettings/{key})
//   3. Catalog default          (NOTIFICATION_CATALOG_BY_KEY[key])
//
// This module intentionally does NOT mutate the dispatcher yet — Phase 3
// folds it into notification-dispatcher.service.ts. For now it's consumed
// by:
//   - The admin preview / test-send paths (so the iframe + test message
//     reflect the effective admin-visible state).
//   - The admin UI "Effective config explainer" badge (per-row source
//     label: platform default / admin override / per-org override).
//   - Unit tests that pin the precedence chain.

export type EffectiveSource =
  | "catalog"
  | "platform_override"
  | "organization_override";

export interface EffectiveNotificationSetting {
  key: string;
  definition: NotificationDefinition;
  enabled: boolean;
  channels: NotificationChannel[];
  subjectOverride?: NotificationSetting["subjectOverride"];
  /**
   * Which layer supplied each field of the effective config. `enabled`
   * and `channels` can come from different layers (an org disables a
   * notification the platform left at its default channels).
   */
  source: {
    enabled: EffectiveSource;
    channels: EffectiveSource;
    subjectOverride: EffectiveSource;
  };
  /** Resolved org layer (null when the request was platform-scope). */
  organizationId: string | null;
  /** The raw platform override row (if any) — handy for the admin UI. */
  platformOverride: NotificationSetting | null;
  /** The raw per-org override row (if any) — handy for the admin UI. */
  organizationOverride: NotificationSetting | null;
}

export class SettingResolutionService {
  /**
   * Resolve the effective setting for a (key, organizationId) pair.
   * Throws if the key isn't in the catalog — callers are expected to
   * validate that up front (admin UI only allows known keys).
   */
  async resolve(
    key: string,
    organizationId: string | null,
  ): Promise<EffectiveNotificationSetting> {
    const definition = NOTIFICATION_CATALOG_BY_KEY[key];
    if (!definition) {
      throw new Error(`Unknown notification key: ${key}`);
    }

    const [platformOverride, organizationOverride] = await Promise.all([
      notificationSettingsRepository.findByKey(key),
      organizationId
        ? notificationSettingsRepository.findByKeyAndOrg(key, organizationId)
        : Promise.resolve<NotificationSetting | null>(null),
    ]);

    return this.merge(definition, organizationId, platformOverride, organizationOverride);
  }

  /**
   * Pure merge helper. Exposed separately so tests can feed fixtures
   * without touching the repository layer, and so the admin list
   * endpoint can resolve many rows in one batched repo read.
   */
  merge(
    definition: NotificationDefinition,
    organizationId: string | null,
    platformOverride: NotificationSetting | null,
    organizationOverride: NotificationSetting | null,
  ): EffectiveNotificationSetting {
    // Phase 2.4 policy constraint: organizers can only tighten a platform
    // setting (disable, remove a channel). The route layer enforces this
    // on PUT; the merge here trusts what's in Firestore so admins can
    // still loosen settings via the super-admin API. Future: add a
    // defensive max-of-platform-and-org guard once we have a test
    // harness for Firestore-stored policy.

    // ── enabled ──
    let enabled = true;
    let enabledSource: EffectiveSource = "catalog";
    if (platformOverride) {
      enabled = platformOverride.enabled;
      enabledSource = "platform_override";
    }
    if (organizationOverride) {
      enabled = organizationOverride.enabled;
      enabledSource = "organization_override";
    }

    // ── channels ──
    let channels: NotificationChannel[] = [...definition.defaultChannels];
    let channelsSource: EffectiveSource = "catalog";
    if (platformOverride) {
      channels = [...platformOverride.channels];
      channelsSource = "platform_override";
    }
    if (organizationOverride) {
      channels = [...organizationOverride.channels];
      channelsSource = "organization_override";
    }
    // Never emit a channel the catalog doesn't advertise as supported —
    // matches the defense-in-depth filter in the dispatcher.
    channels = channels.filter((c) => definition.supportedChannels.includes(c));

    // ── subjectOverride ──
    let subjectOverride = platformOverride?.subjectOverride;
    let subjectSource: EffectiveSource = subjectOverride ? "platform_override" : "catalog";
    if (organizationOverride?.subjectOverride) {
      subjectOverride = organizationOverride.subjectOverride;
      subjectSource = "organization_override";
    }

    return {
      key: definition.key,
      definition,
      enabled,
      channels,
      ...(subjectOverride ? { subjectOverride } : {}),
      source: {
        enabled: enabledSource,
        channels: channelsSource,
        subjectOverride: subjectSource,
      },
      organizationId,
      platformOverride,
      organizationOverride,
    };
  }
}

export const settingResolutionService = new SettingResolutionService();
