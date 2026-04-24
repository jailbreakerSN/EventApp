import { db, COLLECTIONS } from "@/config/firebase";
import { BaseRepository } from "./base.repository";
import type { ApiKey } from "@teranga/shared-types";
import type { PaginatedResult } from "./base.repository";

/**
 * T2.3 — API keys repository.
 *
 * Doc-id convention: `hashPrefix` (first 10 chars of the plaintext
 * `terk_*` key). Authentication lookups hit the doc directly, so we
 * pay O(1) per request regardless of how many keys an org has issued.
 *
 * Other indexed queries (list all keys for an org, active-only, etc.)
 * use `where("organizationId", "==", X)` — see
 * `infrastructure/firebase/firestore.indexes.json` for the composite
 * indexes.
 */
class ApiKeysRepository extends BaseRepository<ApiKey> {
  constructor() {
    super(COLLECTIONS.API_KEYS, "apiKey");
  }

  /**
   * List all keys owned by an org, most-recent first. We do NOT filter
   * by status server-side — the UI always wants to see revoked keys in
   * the list (with a visual status badge) for forensics purposes.
   */
  async listByOrganization(
    organizationId: string,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResult<ApiKey>> {
    return this.findMany([{ field: "organizationId", op: "==", value: organizationId }], {
      page: pagination.page,
      limit: pagination.limit,
      orderBy: "createdAt",
      orderDir: "desc",
    });
  }

  /**
   * Count active keys for an org. Used for plan-limit soft warnings in
   * the issuance UI (V2: add a `maxApiKeys` limit). O(1) aggregation.
   */
  async countActive(organizationId: string): Promise<number> {
    const snap = await db
      .collection(COLLECTIONS.API_KEYS)
      .where("organizationId", "==", organizationId)
      .where("status", "==", "active")
      .count()
      .get();
    return snap.data().count;
  }

  /**
   * Fire-and-forget bookkeeping. NOT transactional — a rare lost write
   * is fine. Middleware calls this on every successful auth.
   */
  async recordUsage(keyId: string, ip: string | null): Promise<void> {
    await db.collection(COLLECTIONS.API_KEYS).doc(keyId).update({
      lastUsedAt: new Date().toISOString(),
      lastUsedIp: ip,
    });
  }
}

export const apiKeysRepository = new ApiKeysRepository();
