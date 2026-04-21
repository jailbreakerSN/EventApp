import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getResend, RESEND_API_KEY } from "../../utils/resend-client";
import { getResendSystemConfig, updateResendSystemConfig } from "./config-store";

// Skill recommendation (resend/references/webhooks.md):
// "Prefer the API to create webhooks programmatically instead of using the
//  dashboard. This is faster, less error-prone, and gives you the signing
//  secret directly in the response."
//
// This callable is the entry-point for that. Idempotent: re-runs don't
// duplicate segments or webhooks. Returns the segment id + webhook id so
// an operator can verify, plus a `webhookSecretWritten` flag so they know
// whether to expect a new Secret Manager version.
//
// Runbook:
//   1. firebase functions:secrets:set RESEND_API_KEY       (real key)
//   2. firebase functions:secrets:set RESEND_WEBHOOK_SECRET (placeholder "pending-bootstrap")
//   3. Deploy Functions — the resendWebhook URL now exists.
//   4. Set RESEND_WEBHOOK_URL env var (or function config) to that URL.
//   5. Invoke bootstrapResendInfra → segment + webhook created, signing
//      secret written as a new Secret Manager version.
//   6. Next webhook delivery from Resend verifies successfully.

const SEGMENT_NAME = "Newsletter Subscribers — Teranga";
const WEBHOOK_EVENTS = [
  "email.bounced",
  "email.complained",
  "contact.updated",
  "contact.deleted",
] as const;

const WEBHOOK_SECRET_NAME = "RESEND_WEBHOOK_SECRET";

export const bootstrapResendInfra = onCall(
  {
    region: "europe-west1",
    memory: "256MiB",
    maxInstances: 1,
    secrets: [RESEND_API_KEY],
  },
  async (request) => {
    // Super-admin only — role claim set via the API's admin service.
    if (!request.auth || request.auth.token.super_admin !== true) {
      throw new HttpsError("permission-denied", "super_admin role required");
    }

    const webhookEndpoint = process.env.RESEND_WEBHOOK_URL;
    if (!webhookEndpoint) {
      throw new HttpsError(
        "failed-precondition",
        "RESEND_WEBHOOK_URL env var not set — deploy the resendWebhook function first, then configure this",
      );
    }

    const resend = getResend();

    // ── 1. Segment ─────────────────────────────────────────────────────
    const existing = await getResendSystemConfig();
    let segmentId = existing.newsletterSegmentId;
    let segmentCreated = false;

    if (!segmentId) {
      const { data, error } = await resend.segments.create({ name: SEGMENT_NAME });
      if (error || !data) {
        throw new HttpsError(
          "internal",
          `Resend segments.create failed: ${error?.message ?? "unknown"}`,
        );
      }
      segmentId = data.id;
      segmentCreated = true;
      logger.info("Created Resend segment", { segmentId, name: SEGMENT_NAME });
    }

    // ── 2. Webhook ─────────────────────────────────────────────────────
    // List first — if a webhook with our endpoint already exists, reuse it.
    // The signing secret is only returned on create, so we can't rotate an
    // existing secret from here without an explicit "force recreate" path
    // (deliberately out of scope — operators can delete via dashboard if
    // they lose the secret).
    const listResp = await resend.webhooks.list();
    if (listResp.error) {
      throw new HttpsError("internal", `Resend webhooks.list failed: ${listResp.error.message}`);
    }
    const webhooksList =
      (listResp.data as { data?: { id: string; endpoint: string }[] } | null)?.data ?? [];
    const existingWebhook = webhooksList.find((w) => w.endpoint === webhookEndpoint);

    let webhookId: string;
    let webhookSecretWritten = false;

    if (existingWebhook) {
      webhookId = existingWebhook.id;
      logger.info("Reusing existing webhook", { webhookId, endpoint: webhookEndpoint });
    } else {
      const { data, error } = await resend.webhooks.create({
        endpoint: webhookEndpoint,
        events: [...WEBHOOK_EVENTS],
      });
      if (error || !data) {
        throw new HttpsError(
          "internal",
          `Resend webhooks.create failed: ${error?.message ?? "unknown"}`,
        );
      }
      webhookId = data.id;

      // Only path that yields a signing_secret — we write it straight to
      // Secret Manager. Requires the Cloud Functions service account to
      // have roles/secretmanager.secretVersionAdder on the secret.
      const signingSecret = (data as unknown as { signing_secret?: string }).signing_secret;
      if (signingSecret) {
        const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
        if (!projectId) {
          throw new HttpsError("internal", "GCLOUD_PROJECT not set; cannot write secret");
        }
        const client = new SecretManagerServiceClient();
        await client.addSecretVersion({
          parent: `projects/${projectId}/secrets/${WEBHOOK_SECRET_NAME}`,
          payload: { data: Buffer.from(signingSecret, "utf8") },
        });
        webhookSecretWritten = true;
        logger.info("Wrote webhook signing secret to Secret Manager", {
          webhookId,
          secretName: WEBHOOK_SECRET_NAME,
        });
      } else {
        logger.warn("Resend did not return a signing_secret on create", { webhookId });
      }
    }

    // ── 3. Persist config for triggers to read ─────────────────────────
    await updateResendSystemConfig({
      newsletterSegmentId: segmentId,
      webhookId,
      webhookEndpoint,
    });

    return {
      segmentId,
      segmentCreated,
      webhookId,
      webhookReused: !!existingWebhook,
      webhookSecretWritten,
    };
  },
);
