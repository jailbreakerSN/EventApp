"use strict";

/**
 * no-direct-email-service (Teranga Phase 2.2)
 *
 * Flags direct calls to `emailService.send*()` in new code. Once the
 * Phase 2.2 dispatcher rollout is validated in prod, every caller
 * should go through `notificationDispatcher.dispatch({ key, ... })`
 * instead — catalog lookup, admin kill-switch, per-key user opt-out
 * and full audit trail only happen on that path.
 *
 * Today (Phase 2.2) this rule is WARN level — a few existing call
 * sites still exist inside emailService itself (the `sendXxx` shims
 * that branch on `isDispatcherEnabled`). These are intentionally
 * excluded via the `allowedFiles` option so the rule stays quiet
 * during the flag-gated rollout. New call sites from *outside* those
 * files will trigger a warning.
 *
 * TODO: flip severity to `error` after Phase 2.3 has soaked in staging
 * for a full week and the remaining shims have been deleted. See
 * docs/notification-system-roadmap.md.
 *
 * Rule pattern:
 *   Flag   -> `emailService.sendFoo(...)` (any identifier starting with `send`)
 *   Ignore -> apps/api/src/services/email.service.ts (internals)
 *   Ignore -> apps/api/src/services/notification-dispatcher.service.ts
 *   Ignore -> **\/__tests__/**, *.test.ts, *.spec.ts (test doubles)
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct emailService.sendXxx() calls outside the dispatcher path. New code must route through notificationDispatcher.dispatch().",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedFiles: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      directCall:
        "Direct emailService.{{method}}() call. Route through notificationDispatcher.dispatch({ key, recipients, params }) instead — see apps/api/src/services/notification-dispatcher.service.ts and the Phase 2.2 roadmap.",
    },
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, "/");
    const options = context.options[0] || {};
    const allowedFiles = (options.allowedFiles || []).map((s) => s.replace(/\\/g, "/"));

    // Skip test files unconditionally — tests legitimately call the
    // emailService shims to assert the dispatcher routing decision.
    const isTest = /\/(__tests__|__mocks__)\//.test(filename) ||
      /\.(test|spec)\.(t|j)sx?$/.test(filename);
    if (isTest) return {};

    // Skip explicit allow-list files (emailService internals, dispatcher).
    for (const allowed of allowedFiles) {
      if (filename.endsWith(allowed) || filename.includes(allowed)) return {};
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.object &&
          callee.object.type === "Identifier" &&
          callee.object.name === "emailService" &&
          callee.property &&
          callee.property.type === "Identifier" &&
          typeof callee.property.name === "string" &&
          callee.property.name.startsWith("send")
        ) {
          context.report({
            node,
            messageId: "directCall",
            data: { method: callee.property.name },
          });
        }
      },
    };
  },
};
