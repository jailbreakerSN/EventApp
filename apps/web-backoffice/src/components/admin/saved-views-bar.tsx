"use client";

import { useState } from "react";
import { Bookmark, Star, X, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSavedViews } from "@/hooks/use-saved-views";

/**
 * T3.2 — Saved-views chip bar.
 *
 * Drop-in above any filter toolbar. Shows the user's saved views for
 * a given surface (keyed by `surfaceKey`, e.g. "admin-users"), plus a
 * "save current filters" affordance. Clicking a chip restores the
 * query. The currently-matching chip (if any) is highlighted.
 *
 * Intentionally presentational: we don't own the filter state; the
 * page component does. Restoring a view just pushes a new URL and
 * the page's existing URL-driven state takes over.
 */
export function SavedViewsBar({ surfaceKey }: { surfaceKey: string }) {
  const t = useTranslations("admin.savedViews");
  const pathname = usePathname();
  const { views, activeViewId, save, remove, apply, currentQuery } = useSavedViews(surfaceKey);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [pendingName, setPendingName] = useState("");

  const canSave = currentQuery.length > 0 && !activeViewId;

  if (views.length === 0 && !canSave) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Bookmark className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{t("label")}</span>

      {views.map((v) => {
        const isActive = v.id === activeViewId;
        // Two adjacent buttons instead of nested buttons (invalid
        // HTML): the left applies the view, the right removes it.
        return (
          <span
            key={v.id}
            className={`inline-flex items-center rounded-full border ${
              isActive
                ? "border-teranga-navy bg-teranga-navy/10 text-teranga-navy"
                : "border-border bg-background"
            }`}
          >
            <button
              type="button"
              onClick={() => apply(v, pathname ?? "")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-l-full ${
                isActive ? "" : "hover:bg-muted"
              }`}
              aria-pressed={isActive}
              aria-label={t("applyAria", { name: v.name })}
            >
              {isActive && <Star className="h-3 w-3 fill-current" aria-hidden />}
              <span>{v.name}</span>
            </button>
            <button
              type="button"
              onClick={() => remove(v.id)}
              className="px-1.5 py-1 rounded-r-full text-muted-foreground hover:text-destructive hover:bg-muted"
              aria-label={t("removeAria", { name: v.name })}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        );
      })}

      {canSave && !showSavePrompt && (
        <button
          type="button"
          onClick={() => setShowSavePrompt(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2.5 py-1 text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" aria-hidden /> {t("savePrompt")}
        </button>
      )}

      {showSavePrompt && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingName.trim()) {
              save(pendingName);
              setPendingName("");
              setShowSavePrompt(false);
            }
          }}
          className="inline-flex items-center gap-1"
        >
          <input
            ref={(el) => el?.focus()}
            type="text"
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setShowSavePrompt(false);
                setPendingName("");
              }
            }}
            placeholder={t("namePlaceholder")}
            maxLength={40}
            className="rounded border border-border px-2 py-1 text-xs"
            aria-label={t("nameLabel")}
          />
          <button
            type="submit"
            className="rounded bg-teranga-navy px-2 py-1 text-white disabled:opacity-50"
            disabled={!pendingName.trim()}
          >
            {t("confirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSavePrompt(false);
              setPendingName("");
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("cancelAria")}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </form>
      )}
    </div>
  );
}
