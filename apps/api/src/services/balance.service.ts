import {
  type BalanceTransaction,
  type BalanceTransactionQuery,
  type OrganizationBalance,
} from "@teranga/shared-types";
import { balanceTransactionRepository } from "@/repositories/balance-transaction.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { computeBalance } from "./balance-ledger";
import type { PaginatedResult } from "@/repositories/base.repository";

// ─── Balance Service ─────────────────────────────────────────────────────────
// Thin I/O shell around the pure `computeBalance()` fold defined in
// `./balance-ledger`. Two endpoints: the aggregate summary (used by the
// /finance page header cards) and the paginated transactions list (used by
// the Transactions tab). All access is gated by `payment:view_reports` +
// `requireOrganizationAccess()` so participants can never read another
// org's ledger.

class BalanceService extends BaseService {
  /**
   * Aggregate balance for an organization. Reads every ledger entry and
   * folds them into the `OrganizationBalance` shape. Single-indexed scan
   * on `organizationId` — cheap for current scale; when we outgrow memory,
   * the right move is a per-org materialised `balanceSummaries/{orgId}`
   * doc maintained by a Pub/Sub listener. Not read-time pagination.
   */
  async getBalance(organizationId: string, user: AuthUser): Promise<OrganizationBalance> {
    this.requirePermission(user, "payment:view_reports");
    this.requireOrganizationAccess(user, organizationId);

    const entries = await balanceTransactionRepository.findAllByOrganization(organizationId);
    return computeBalance(entries, new Date());
  }

  /**
   * Paginated ledger entries for an organization. Used by the Transactions
   * tab on /finance; supports the full filter surface on the `BalanceTransactionQuerySchema`
   * (kind, status, eventId, date range).
   */
  async listTransactions(
    organizationId: string,
    query: BalanceTransactionQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<BalanceTransaction>> {
    this.requirePermission(user, "payment:view_reports");
    this.requireOrganizationAccess(user, organizationId);

    const { page, limit, ...filters } = query;
    return balanceTransactionRepository.findByOrganization(organizationId, filters, {
      page,
      limit,
    });
  }
}

export const balanceService = new BalanceService();
