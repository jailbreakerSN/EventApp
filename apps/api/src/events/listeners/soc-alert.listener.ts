/**
 * Sprint-3 T4.1 closure — SOC alert listener.
 *
 * Posts a JSON payload to a configurable webhook on every critical
 * audit action so the security operations team gets a real-time
 * heads-up without polling the `auditLogs` collection.
 *
 * Critical actions covered (the rationale is "would I want to wake
 * up at 3am if this fired without a planned maintenance"):
 *
 *   - `user.role_changed`              — privilege escalation, the
 *                                        single most sensitive lifecycle
 *                                        operation.
 *   - `user.impersonated`              — identity assumption; rare,
 *                                        always interesting.
 *   - `user.impersonation_ended`       — completes the audit trail
 *                                        for the start above.
 *   - `subscription.cancelled`         — revenue impact + churn signal.
 *   - `api_key.created`                — new auth surface created.
 *   - `api_key.rotated`                — secret rotation (often
 *                                        post-incident).
 *   - `api_key.revoked`                — incident response.
 *
 * Wire format:
 *   {
 *     "service": "teranga-api",
 *     "env": "<NODE_ENV>",
 *     "action": "<event name>",
 *     "actorId": "<uid>",
 *     "actorRole": "<role|null>",
 *     "resourceId": "<id|null>",
 *     "organizationId": "<id|null>",
 *     "timestamp": "<ISO 8601>",
 *     "summary": "<human-readable message>",
 *     "requestId": "<id>"
 *   }
 *
 * Fire-and-forget: posts use the global `fetch` with a 5s timeout.
 * Errors log to stderr but never block the originating request — a
 * SOC outage must not produce 500s on user-facing flows. This is
 * the canonical "best-effort observability" pattern; if the SOC
 * channel is critical for compliance, deploy alongside a redundant
 * tail of the `auditLogs` collection.
 */

import { eventBus } from "@/events/event-bus";
import { config } from "@/config";

const TIMEOUT_MS = 5_000;

type AlertSeverity = "info" | "warning" | "critical";

interface AlertPayload {
  service: "teranga-api";
  env: string;
  action: string;
  severity: AlertSeverity;
  actorId: string | null;
  actorRole?: string | null;
  resourceId: string | null;
  organizationId: string | null;
  timestamp: string;
  summary: string;
  requestId: string;
}

async function post(payload: AlertPayload): Promise<void> {
  const url = config.SOC_ALERT_WEBHOOK_URL;
  if (!url) return; // No webhook configured — silently no-op.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      process.stderr.write(
        `[soc-alert] webhook returned ${res.status} for ${payload.action}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[soc-alert] failed to post ${payload.action}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function registerSocAlertListeners(): void {
  // Skip wiring entirely when no webhook is configured. Avoids an
  // empty `eventBus.on` listener taking up a slot in the
  // reference-count test and keeps `eventBus.listenerCount` honest.
  if (!config.SOC_ALERT_WEBHOOK_URL) return;

  const env = process.env.NODE_ENV ?? "development";

  eventBus.on("user.role_changed", async (payload) => {
    await post({
      service: "teranga-api",
      env,
      action: "user.role_changed",
      severity: "critical",
      actorId: payload.actorId,
      resourceId: payload.targetUserId,
      organizationId: null,
      timestamp: payload.timestamp,
      summary: `Roles changed for ${payload.targetUserId}: ${payload.oldRoles.join("|") || "—"} → ${payload.newRoles.join("|")}`,
      requestId: payload.requestId,
    });
  });

  eventBus.on("user.impersonated", async (payload) => {
    // UserImpersonatedEvent does NOT extend BaseEventPayload — it
    // carries `actorUid` / `targetUid` / `expiresAt` only. We use
    // the impersonation start time as the alert timestamp and
    // mint a synthetic requestId so the SOC payload still parses.
    await post({
      service: "teranga-api",
      env,
      action: "user.impersonated",
      severity: "critical",
      actorId: payload.actorUid,
      resourceId: payload.targetUid,
      organizationId: null,
      timestamp: new Date().toISOString(),
      summary: `Impersonation session opened (actor=${payload.actorUid} → target=${payload.targetUid}, expires=${payload.expiresAt})`,
      requestId: "impersonation-event",
    });
  });

  eventBus.on("user.impersonation_ended", async (payload) => {
    await post({
      service: "teranga-api",
      env,
      action: "user.impersonation_ended",
      severity: "info",
      actorId: payload.actorUid,
      resourceId: payload.targetUid,
      organizationId: null,
      timestamp: new Date().toISOString(),
      summary: `Impersonation session closed (actor=${payload.actorUid} ended target=${payload.targetUid})`,
      requestId: "impersonation-event",
    });
  });

  eventBus.on("subscription.cancelled", async (payload) => {
    await post({
      service: "teranga-api",
      env,
      action: "subscription.cancelled",
      severity: "warning",
      actorId: payload.actorId,
      resourceId: payload.organizationId,
      organizationId: payload.organizationId,
      timestamp: payload.timestamp,
      summary: `Subscription ${payload.planKey} cancelled for org ${payload.organizationId} (by ${payload.cancelledBy}, effective ${payload.effectiveAt})`,
      requestId: payload.requestId,
    });
  });

  eventBus.on("api_key.created", async (payload) => {
    await post({
      service: "teranga-api",
      env,
      action: "api_key.created",
      severity: "warning",
      actorId: payload.actorId,
      resourceId: payload.apiKeyId,
      organizationId: payload.organizationId,
      timestamp: payload.timestamp,
      summary: `API key "${payload.name}" issued for org ${payload.organizationId} (env=${payload.environment}, scopes=${payload.scopes.join(",")})`,
      requestId: payload.requestId,
    });
  });

  eventBus.on("api_key.rotated", async (payload) => {
    await post({
      service: "teranga-api",
      env,
      action: "api_key.rotated",
      severity: "warning",
      actorId: payload.actorId,
      resourceId: payload.newApiKeyId,
      organizationId: payload.organizationId,
      timestamp: payload.timestamp,
      summary: `API key rotated for org ${payload.organizationId} (${payload.previousApiKeyId} → ${payload.newApiKeyId})`,
      requestId: payload.requestId,
    });
  });

  eventBus.on("api_key.revoked", async (payload) => {
    await post({
      service: "teranga-api",
      env,
      action: "api_key.revoked",
      severity: "warning",
      actorId: payload.actorId,
      resourceId: payload.apiKeyId,
      organizationId: payload.organizationId,
      timestamp: payload.timestamp,
      summary: `API key ${payload.apiKeyId} revoked for org ${payload.organizationId}: ${payload.reason}`,
      requestId: payload.requestId,
    });
  });
}
