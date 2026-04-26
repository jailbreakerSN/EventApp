"use client";

/**
 * Organizer overhaul — Phase O9.
 *
 * Cohort CSV download trigger. Renders a primary button + a small
 * segment selector (4 options: attended / no_show / cancelled / all).
 * On click, the hook fetches `cohort.csv` with the bearer token and
 * triggers a Blob download. Errors surface as an `<InlineErrorBanner>`
 * the parent renders alongside, since the toolbar is shared between
 * multiple buttons (the banner pattern is owned at the page level).
 */

import { useState } from "react";
import { Download, ChevronDown, Check } from "lucide-react";
import { Button } from "@teranga/shared-ui";
import { useDownloadCohortCsv } from "@/hooks/use-post-event";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import { cn } from "@/lib/utils";
import type { CohortSegment } from "@teranga/shared-types";

const SEGMENT_LABEL: Record<CohortSegment, { label: string; helper: string }> = {
  attended: { label: "Présents", helper: "Pour la campagne « merci d'être venu »" },
  no_show: { label: "No-show", helper: "Pour la campagne « on vous a raté »" },
  cancelled: { label: "Annulés", helper: "Pour comprendre les annulations" },
  all: { label: "Tous", helper: "Liste complète, sans filtre" },
};

const SEGMENT_ORDER: CohortSegment[] = ["attended", "no_show", "cancelled", "all"];

export interface CohortExportButtonProps {
  eventId: string;
  /** Whether the event is final (no_show only meaningful after the end). */
  isFinal: boolean;
  onError?: (error: ResolvedError) => void;
}

export function CohortExportButton({ eventId, isFinal, onError }: CohortExportButtonProps) {
  const [segment, setSegment] = useState<CohortSegment>("all");
  const [open, setOpen] = useState(false);
  const download = useDownloadCohortCsv(eventId);
  const { resolve: resolveError } = useErrorHandler();

  const handleClick = async () => {
    try {
      await download.mutateAsync(segment);
    } catch (err) {
      onError?.(resolveError(err));
    }
  };

  return (
    <div className="relative inline-flex">
      <Button onClick={handleClick} disabled={download.isPending} size="sm">
        <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
        {download.isPending
          ? "Export en cours…"
          : `Exporter ${SEGMENT_LABEL[segment].label.toLowerCase()}`}
      </Button>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choisir le segment"
        className="ml-1 inline-flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-accent/40 motion-safe:transition-colors"
      >
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        // Click-outside backdrop — closes the menu when the user
        // clicks anywhere else, mirroring the SavedViewsMenu pattern
        // from O7.
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default"
        />
      )}

      {open && (
        <ul
          role="menu"
          className="absolute right-0 top-full mt-1 z-40 w-72 rounded-md border border-border bg-background shadow-lg overflow-hidden"
        >
          {SEGMENT_ORDER.map((s) => {
            const disabled = s === "no_show" && !isFinal;
            return (
              <li key={s} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={segment === s}
                  disabled={disabled}
                  onClick={() => {
                    setSegment(s);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 hover:bg-accent/40 motion-safe:transition-colors flex items-start gap-2",
                    disabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 mt-0.5",
                      segment === s ? "text-primary" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{SEGMENT_LABEL[s].label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {disabled
                        ? "Disponible après la fin de l'événement"
                        : SEGMENT_LABEL[s].helper}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
