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
  recommendedChannel: "banner" | "toast";
}

/**
 * Backoffice twin of the participant useErrorHandler — same contract,
 * same `errors.*` catalog shape. Keep them in sync (both apps share the
 * ERROR_CODES union from @teranga/shared-types). See
 * docs/design-system/error-handling.md for the channel-selection rules.
 */
export function useErrorHandler() {
  const tErrors = useTranslations("errors");

  const resolve = useCallback(
    (error: unknown): ResolvedError & { toast: () => void } => {
      const descriptor = extractErrorDescriptor(error);
      const severity = severityFor(descriptor);

      // Observability hook — same contract as the participant twin. See
      // packages/shared-types/src/error-reporter.ts.
      if (severity !== "info") {
        reportError(error, descriptor);
        if (process.env.NODE_ENV === "development") {
           
          console.error(
            `[teranga:error] code=${descriptor.code}${descriptor.reason ? ` reason=${descriptor.reason}` : ""}`,
            error,
          );
        }
      }

      const reasonPath =
        descriptor.code === "REGISTRATION_CLOSED" && descriptor.reason
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
