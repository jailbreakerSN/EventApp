import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  extractErrorDescriptor,
  severityFor,
  reportError,
  type ErrorDescriptor,
  type ErrorSeverity,
} from "@teranga/shared-types";

export interface ResolvedError {
  descriptor: ErrorDescriptor;
  severity: ErrorSeverity;
  title: string;
  description: string;
  /**
   * Whether the caller should render a persistent `<InlineErrorBanner>`
   * (blocking a form submit) or a transient toast. Callers are free to
   * override — this is just a sensible default, aligned with
   * `docs/design-system/error-handling.md`.
   */
  recommendedChannel: "banner" | "toast";
}

/**
 * Single entry point for turning an unknown thrown error into
 * user-facing UI copy. Resolves:
 *
 * 1. Structured `code` + optional `details.reason` via extractErrorDescriptor
 * 2. Localised title/description via next-intl `errors.*` catalog
 *    (falls back to `errors.unknown` for unrecognised codes)
 * 3. UI severity (destructive / warning / info)
 * 4. A recommended display channel so callers don't have to think about
 *    whether to toast or banner a given error
 *
 * Usage:
 *   const { resolve } = useErrorHandler();
 *   try { ... } catch (err) {
 *     const resolved = resolve(err);
 *     if (resolved.recommendedChannel === "banner") setError(resolved);
 *     else resolved.toast();
 *   }
 *
 * In Phase 3 this hook also reports every resolved error to Sentry with
 * `error.code` as a tag. Intentionally not wired here yet — Phase 3 adds
 * the `onReport` callback and the Sentry import.
 */
export function useErrorHandler() {
  const tErrors = useTranslations("errors");

  const resolve = useCallback(
    (error: unknown): ResolvedError & { toast: () => void } => {
      const descriptor = extractErrorDescriptor(error);
      const severity = severityFor(descriptor);

      // Observability hook — route to whatever reporter the app has
      // registered (Sentry/Glitchtip/Datadog RUM/nothing). Skipping
      // `info` severity avoids noise from "already registered" conflicts
      // that are expected user feedback, not bugs. In development we
      // also mirror to the console so dev sessions get visibility
      // without needing a vendor wired up.
      if (severity !== "info") {
        reportError(error, descriptor);
        if (process.env.NODE_ENV === "development") {
          console.error(
            `[teranga:error] code=${descriptor.code}${descriptor.reason ? ` reason=${descriptor.reason}` : ""}`,
            error,
          );
        }
      }

      // Any code may carry a typed `reason` (REGISTRATION_CLOSED,
      // CONFLICT.duplicate_registration, ORGANIZATION_PLAN_LIMIT.*,
      // VALIDATION_ERROR.*) — always try the reason-specific copy first
      // and fall back to the generic code copy if the reason isn't in
      // the catalog. See docs/design-system/error-handling.md § "i18n".
      const reasonPath = descriptor.reason
        ? `${descriptor.code}.reasons.${descriptor.reason}`
        : null;

      const { title, description } = lookupCopy(tErrors, descriptor, reasonPath);

      const recommendedChannel: "banner" | "toast" = severity === "info" ? "toast" : "banner";

      const resolved: ResolvedError = {
        descriptor,
        severity,
        title,
        description,
        recommendedChannel,
      };

      return {
        ...resolved,
        toast: () => {
          // Even when we pick a banner, consumers occasionally want to ALSO
          // raise a toast (e.g. when the form is off-screen). Severity-aware
          // so destructive stays red, warning stays amber.
          const toastFn =
            severity === "destructive"
              ? toast.error
              : severity === "warning"
                ? (toast.warning ?? toast)
                : (toast.info ?? toast);
          toastFn(title, { description });
        },
      };
    },
    [tErrors],
  );

  return { resolve };
}

type TranslateFn = ReturnType<typeof useTranslations>;

function lookupCopy(
  t: TranslateFn,
  descriptor: ErrorDescriptor,
  reasonPath: string | null,
): { title: string; description: string } {
  // Try the most specific catalog entry first, falling back gracefully.
  // next-intl throws on missing keys, so we wrap each lookup.
  const tryPath = (path: string): { title: string; description: string } | null => {
    try {
      return {
        title: t(`${path}.title`),
        description: t(`${path}.description`),
      };
    } catch {
      return null;
    }
  };

  if (reasonPath) {
    const reasonCopy = tryPath(reasonPath);
    if (reasonCopy) return reasonCopy;
  }

  if (descriptor.hasCode) {
    const codeCopy = tryPath(descriptor.code);
    if (codeCopy) return codeCopy;
  }

  const fallback = tryPath("unknown");
  if (fallback) {
    // If the API provided a message and we're falling back to "unknown",
    // prefer the server message for the description so we don't hide
    // information that might actually help the user.
    if (descriptor.message && descriptor.message.length > 0) {
      return { title: fallback.title, description: descriptor.message };
    }
    return fallback;
  }

  return {
    title: "Une erreur est survenue",
    description: descriptor.message ?? "Veuillez réessayer.",
  };
}
