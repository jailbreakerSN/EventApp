import { type AuditLogEntry } from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";

// ─── Service ────────────────────────────────────────────────────────────────

class AuditService {
  private get collection() {
    return db.collection(COLLECTIONS.AUDIT_LOGS);
  }

  /**
   * Write an audit log entry. Fire-and-forget — callers should not await.
   * Errors are caught and logged, never propagated.
   */
  async log(entry: Omit<AuditLogEntry, "id">): Promise<void> {
    try {
      const docRef = this.collection.doc();
      await docRef.set({
        id: docRef.id,
        ...entry,
      });
    } catch (err) {
      // Audit logging must never break the request flow
      process.stderr.write(`[AuditService] Failed to write audit log: ${err}\n`);
    }
  }
}

export const auditService = new AuditService();
