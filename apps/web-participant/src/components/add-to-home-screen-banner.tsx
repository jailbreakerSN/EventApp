"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { HomeIcon, Share2, Download, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@teranga/shared-ui";
import { useAddToHomeScreen } from "@/hooks/use-add-to-home-screen";

// ─── AddToHomeScreenBanner (Phase D.5) ──────────────────────────────────────
// Participant-only. Rendered at "meaningful moments" (home, post-registration
// success) where the user has signalled enough engagement to make the ask
// feel earned. Gates are enforced in `useAddToHomeScreen`:
//   - not already a PWA
//   - iOS Safari OR Android Chrome-like
//   - >= 3 visits
//   - dismissed < 3 times AND last dismissal > 7 days ago
//
// Visual contract matches the Phase C.2 PushPermissionBanner:
//   - bottom-anchored is left to the caller's layout; the component itself
//     is a standalone card with role="region" so keyboard users can reach it.
//   - dismissible via the close button or the "Plus tard" CTA.
//   - primary CTA opens an <AddToHomeScreenDialog> with platform-appropriate
//     instructions. Android users get a one-tap programmatic prompt; iOS
//     users see a 3-step Safari walkthrough.
//
// Copy lives under `pwa.addToHomeScreen.*` in the fr / en / wo message
// bundles. No English fall-through — next-intl resolves to the active
// locale or crashes at build time if a key is missing, which is correct.

export function AddToHomeScreenBanner({ className }: { className?: string }) {
  const t = useTranslations("pwa.addToHomeScreen");
  const { canShow, isIos, isAndroidChrome, trigger, dismiss, promptAndroid } =
    useAddToHomeScreen();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [androidOutcome, setAndroidOutcome] = useState<"idle" | "pending">("idle");
  const triggerElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Remember which element was focused when the banner first rendered so
    // we can restore focus on dismiss / close.
    if (!canShow) return;
    if (typeof document === "undefined") return;
    triggerElRef.current = (document.activeElement as HTMLElement) ?? null;
  }, [canShow]);

  const handleCta = useCallback(async () => {
    const outcome = await trigger();
    if (outcome === "instructed") {
      // iOS — show the 3-step Safari walkthrough.
      setDialogOpen(true);
      return;
    }
    if (outcome === "installed") {
      // Android accepted — banner will flip off once `useIsPwa` sees the
      // standalone media query on next paint. Close the dialog defensively.
      setDialogOpen(false);
      return;
    }
    // Android dismissed OR no prompt event available yet — open the dialog
    // so the user at least sees the instructions and can retry later.
    setDialogOpen(true);
  }, [trigger]);

  const handleDismiss = useCallback(() => {
    dismiss();
    setDialogOpen(false);
    queueMicrotask(() => {
      triggerElRef.current?.focus();
    });
  }, [dismiss]);

  const handleAndroidPromptInDialog = useCallback(async () => {
    setAndroidOutcome("pending");
    try {
      await promptAndroid();
    } finally {
      setAndroidOutcome("idle");
      setDialogOpen(false);
    }
  }, [promptAndroid]);

  if (!canShow) return null;

  return (
    <>
      <div
        role="region"
        aria-label={t("bannerTitle")}
        className={[
          "relative flex flex-wrap items-start gap-3 rounded-card border border-teranga-navy/20 bg-teranga-navy/[0.04] p-4 text-sm dark:border-teranga-gold/30 dark:bg-teranga-gold/10",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teranga-navy/10 text-teranga-navy dark:bg-teranga-gold/20 dark:text-teranga-gold-dark">
          <Download className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="font-semibold text-foreground">{t("bannerTitle")}</p>
          <p className="mt-0.5 text-muted-foreground">{t("bannerBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCta}
              className="inline-flex items-center gap-1.5 rounded-full bg-teranga-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t("bannerCta")}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t("bannerDismiss")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("bannerDismiss")}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Install instructions dialog. Platform-branched body, shared chrome. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent closeLabel={t("closeDialog")}>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            {isAndroidChrome && !isIos && (
              <DialogDescription>{t("androidInstructions")}</DialogDescription>
            )}
          </DialogHeader>

          {/* iOS walkthrough — three numbered steps. Operators can later
              drop screenshot PNG assets next to the list; for now the icons
              carry enough signal on their own. */}
          {isIos && (
            <ol className="mt-4 space-y-3" aria-label={t("dialogTitle")}>
              <li className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/40 p-3">
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teranga-navy text-[11px] font-semibold text-white"
                  aria-hidden="true"
                >
                  1
                </span>
                <span className="flex flex-1 items-start gap-2 text-sm text-foreground">
                  <Share2
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-teranga-navy"
                    aria-hidden="true"
                  />
                  {t("iosStep1")}
                </span>
              </li>
              <li className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/40 p-3">
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teranga-navy text-[11px] font-semibold text-white"
                  aria-hidden="true"
                >
                  2
                </span>
                <span className="flex flex-1 items-start gap-2 text-sm text-foreground">
                  <HomeIcon
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-teranga-navy"
                    aria-hidden="true"
                  />
                  {t("iosStep2")}
                </span>
              </li>
              <li className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/40 p-3">
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teranga-navy text-[11px] font-semibold text-white"
                  aria-hidden="true"
                >
                  3
                </span>
                <span className="flex-1 text-sm text-foreground">{t("iosStep3")}</span>
              </li>
            </ol>
          )}

          {/* Android path — one tap. The browser owns the rest of the flow. */}
          {isAndroidChrome && !isIos && (
            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={handleAndroidPromptInDialog}
                disabled={androidOutcome === "pending"}
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-teranga-navy px-5 py-2 text-sm font-semibold text-white hover:bg-teranga-navy/90 disabled:opacity-50 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("androidCta")}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
