import type { FastifyInstance } from "fastify";
import { eventRoutes } from "./events.routes";
import { registrationRoutes } from "./registrations.routes";
import { badgeRoutes } from "./badges.routes";
import { badgeTemplateRoutes } from "./badge-templates.routes";
import { checkinRoutes } from "./checkin.routes";
import { userRoutes } from "./users.routes";
import { organizationRoutes } from "./organizations.routes";
import { inviteRoutes } from "./invites.routes";
import { sessionRoutes } from "./sessions.routes";
import { feedRoutes } from "./feed.routes";
import { messagingRoutes } from "./messaging.routes";
import { healthRoutes } from "./health.routes";
import { paymentRoutes } from "./payments.routes";
import { receiptRoutes } from "./receipts.routes";
import { payoutRoutes } from "./payouts.routes";
import { communicationRoutes, commsRoutes } from "./communications.routes";
import { notificationRoutes } from "./notifications.routes";
import { speakerRoutes } from "./speakers.routes";
import { sponsorRoutes } from "./sponsors.routes";
import { promoCodeRoutes } from "./promo-codes.routes";
import { adminRoutes } from "./admin.routes";
import { impersonationRoutes } from "./impersonation.routes";
import { venueRoutes } from "./venues.routes";
import { newsletterRoutes } from "./newsletter.routes";
import { authEmailRoutes } from "./auth-email.routes";
import { subscriptionRoutes } from "./subscriptions.routes";
import { planRoutes, adminPlanRoutes } from "./plans.routes";
import { adminCouponRoutes, publicCouponRoutes } from "./plan-coupons.routes";
import { balanceRoutes } from "./balance.routes";
import { meRoutes } from "./me.routes";
import { apiKeysRoutes } from "./api-keys.routes";
import { announcementsRoutes } from "./announcements.routes";

export async function registerRoutes(app: FastifyInstance) {
  // ── Health & Readiness (no auth, no rate limit) ──────────────────────────
  await app.register(healthRoutes);

  // ── API v1 ───────────────────────────────────────────────────────────────
  await app.register(eventRoutes, { prefix: "/v1/events" });
  await app.register(checkinRoutes, { prefix: "/v1/events" });
  await app.register(registrationRoutes, { prefix: "/v1/registrations" });
  await app.register(badgeRoutes, { prefix: "/v1/badges" });
  await app.register(badgeTemplateRoutes, { prefix: "/v1/badge-templates" });
  await app.register(userRoutes, { prefix: "/v1/users" });
  await app.register(organizationRoutes, { prefix: "/v1/organizations" });
  await app.register(inviteRoutes, { prefix: "/v1/invites" });
  await app.register(sessionRoutes, { prefix: "/v1/events" });
  await app.register(feedRoutes, { prefix: "/v1/events" });
  await app.register(messagingRoutes, { prefix: "/v1/conversations" });
  await app.register(paymentRoutes, { prefix: "/v1/payments" });
  await app.register(receiptRoutes, { prefix: "/v1/receipts" });
  await app.register(payoutRoutes, { prefix: "/v1/payouts" });
  await app.register(communicationRoutes, { prefix: "/v1/events" });
  await app.register(commsRoutes, { prefix: "/v1/comms" });
  await app.register(notificationRoutes, { prefix: "/v1/notifications" });
  await app.register(speakerRoutes, { prefix: "/v1/events" });
  await app.register(sponsorRoutes, { prefix: "/v1/events" });
  await app.register(promoCodeRoutes, { prefix: "/v1/events" });
  await app.register(adminRoutes, { prefix: "/v1/admin" });
  await app.register(impersonationRoutes, { prefix: "/v1/impersonation" });
  await app.register(adminPlanRoutes, { prefix: "/v1/admin/plans" });
  await app.register(adminCouponRoutes, { prefix: "/v1/admin/coupons" });
  await app.register(planRoutes, { prefix: "/v1/plans" });
  await app.register(publicCouponRoutes, { prefix: "/v1/plans" });
  await app.register(venueRoutes, { prefix: "/v1/venues" });
  await app.register(newsletterRoutes, { prefix: "/v1/newsletter" });
  await app.register(authEmailRoutes, { prefix: "/v1/auth" });
  await app.register(subscriptionRoutes); // paths include /v1/organizations prefix
  await app.register(balanceRoutes); // paths include /v1/organizations prefix
  await app.register(apiKeysRoutes); // paths include /v1/organizations prefix
  await app.register(announcementsRoutes); // paths include /v1 prefix
  await app.register(meRoutes, { prefix: "/v1/me" });
}
