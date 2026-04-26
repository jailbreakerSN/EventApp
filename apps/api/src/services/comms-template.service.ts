/**
 * Organizer overhaul — Phase O5.
 *
 * Read-only service exposing the static communications template
 * library shipped via `SEED_COMMS_TEMPLATES` in shared-types. Future
 * iterations will layer organisation-scoped CUSTOM templates on top
 * of the seed via a Firestore collection — the contract here is the
 * place that union will land.
 *
 * The template library itself is not user data. We don't gate it
 * behind `requireOrganizationAccess` — any signed-in caller with
 * `broadcast:read` (which the organizer/co-organizer/super-admin
 * roles all hold) can list templates. The composer is the gated
 * surface; templates are just the editorial copy.
 */

import { BaseService } from "./base.service";
import {
  SEED_COMMS_TEMPLATES,
  type CommsTemplate,
  type CommsTemplateCategory,
} from "@teranga/shared-types";
import type { AuthUser } from "@/middlewares/auth.middleware";

export interface ListTemplatesQuery {
  /** Optional category filter — used by the library tabbed UI. */
  category?: CommsTemplateCategory;
}

class CommsTemplateService extends BaseService {
  /** Returns templates filtered by category (when provided). */
  list(user: AuthUser, query: ListTemplatesQuery = {}): readonly CommsTemplate[] {
    this.requirePermission(user, "broadcast:read");
    if (!query.category) return SEED_COMMS_TEMPLATES;
    return SEED_COMMS_TEMPLATES.filter((t) => t.category === query.category);
  }

  /** Returns a single template by id, or null when absent. */
  getById(user: AuthUser, id: string): CommsTemplate | null {
    this.requirePermission(user, "broadcast:read");
    return SEED_COMMS_TEMPLATES.find((t) => t.id === id) ?? null;
  }
}

export const commsTemplateService = new CommsTemplateService();
