import { db } from "../../utils/admin";

// `systemConfig/resend` is written by bootstrapResendInfra and read by
// every trigger that needs the Segment id. Kept out of Secret Manager
// because the segment id is non-sensitive — just a reference — and
// pulling it from Firestore keeps the config observable (admin UI can
// show "bootstrap status" by reading the same doc).

const CONFIG_COLLECTION = "systemConfig";
const CONFIG_DOC_ID = "resend";

export interface ResendSystemConfig {
  newsletterSegmentId?: string;
  webhookId?: string;
  webhookEndpoint?: string;
  bootstrappedAt?: string;
}

/**
 * Read the current Resend system config. Every trigger call hits Firestore
 * directly — caching was considered but rejected: the trigger volume is low,
 * Firestore reads are cheap, and caching introduces "bootstrap completed but
 * functions still see old state" bugs.
 */
export async function getResendSystemConfig(): Promise<ResendSystemConfig> {
  const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID).get();
  return snap.exists ? ((snap.data() ?? {}) as ResendSystemConfig) : {};
}

export async function updateResendSystemConfig(patch: Partial<ResendSystemConfig>): Promise<void> {
  await db
    .collection(CONFIG_COLLECTION)
    .doc(CONFIG_DOC_ID)
    .set({ ...patch, bootstrappedAt: new Date().toISOString() }, { merge: true });
}
