"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useTranslations } from "next-intl";

interface SaveEventButtonProps {
  eventId: string;
}

const STORAGE_KEY = "teranga-saved-events";

/**
 * Lightweight "save for later" toggle on the event detail back bar.
 *
 * Backed by localStorage for now — once a `saved_events` backend exists the
 * toggle can fan out to the API without changing the UX. Kept deliberately
 * local-first so the feature works offline and on first-time visitors who
 * haven't signed in yet.
 */
export function SaveEventButton({ eventId }: SaveEventButtonProps) {
  const t = useTranslations("events.detail");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as string[];
      setSaved(list.includes(eventId));
    } catch {
      // localStorage unavailable (private mode, SSR hydration quirk) — ignore.
    }
  }, [eventId]);

  const toggle = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      const next = saved ? list.filter((id) => id !== eventId) : [...list, eventId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaved(!saved);
    } catch {
      // Best-effort — don't crash the page if storage is unavailable.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? t("saved") : t("save")}
      className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:text-teranga-gold-dark"
    >
      {saved ? (
        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="hidden sm:inline">{saved ? t("saved") : t("save")}</span>
    </button>
  );
}
