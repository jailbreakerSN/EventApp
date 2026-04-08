"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

export interface ShortcutDefinition {
  keys: string | string[];
  description: string;
  category: "Navigation" | "Actions";
  action: () => void;
}

/**
 * Returns true if the currently-focused element is an input-like element where
 * keyboard shortcuts should be suppressed.
 */
function isFocusInInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/** Format a key combo/sequence as a human-readable label, e.g. ["g","e"] → "g  e" */
export function formatKeys(keys: string | string[]): string[] {
  if (typeof keys === "string") return [keys];
  return keys;
}

export interface UseKeyboardShortcutsOptions {
  onShowHelp: () => void;
}

export function useKeyboardShortcuts({ onShowHelp }: UseKeyboardShortcutsOptions) {
  const router = useRouter();

  // Tracks whether "g" was pressed and we're waiting for a follow-up key
  const prefixActiveRef = useRef(false);
  const prefixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPrefix = useCallback(() => {
    prefixActiveRef.current = false;
    if (prefixTimerRef.current) {
      clearTimeout(prefixTimerRef.current);
      prefixTimerRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Never fire shortcuts when inside a form control
      if (isFocusInInput()) {
        clearPrefix();
        return;
      }

      // Ignore combos with meta/ctrl/alt to avoid clashing with browser/OS shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      // --- "?" → show help dialog ---
      if (key === "?" || key === "/") {
        e.preventDefault();
        clearPrefix();
        onShowHelp();
        return;
      }

      // --- "g" prefix handler ---
      if (prefixActiveRef.current) {
        // Second key in g-sequence
        clearPrefix();
        e.preventDefault();

        switch (key.toLowerCase()) {
          case "d":
            router.push("/dashboard");
            break;
          case "e":
            router.push("/events");
            break;
          case "n":
            router.push("/events/new");
            break;
          case "s":
            router.push("/settings");
            break;
          case "o":
            router.push("/organization");
            break;
          case "c":
            router.push("/communications");
            break;
          case "f":
            router.push("/finance");
            break;
        }
        return;
      }

      // Activate "g" prefix
      if (key.toLowerCase() === "g") {
        e.preventDefault();
        prefixActiveRef.current = true;
        // Reset if no follow-up key comes within 1 second
        prefixTimerRef.current = setTimeout(clearPrefix, 1000);
      }
    },
    [router, onShowHelp, clearPrefix]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearPrefix();
    };
  }, [handleKeyDown, clearPrefix]);
}

/**
 * Static shortcut catalogue — used by the help dialog and, if needed, by other
 * components to render hint labels.
 */
export const SHORTCUT_DEFINITIONS: Omit<ShortcutDefinition, "action">[] = [
  // Navigation
  { keys: ["g", "d"], description: "Tableau de bord", category: "Navigation" },
  { keys: ["g", "e"], description: "Événements", category: "Navigation" },
  { keys: ["g", "n"], description: "Nouvel événement", category: "Navigation" },
  { keys: ["g", "s"], description: "Paramètres", category: "Navigation" },
  { keys: ["g", "o"], description: "Organisation", category: "Navigation" },
  { keys: ["g", "c"], description: "Communications", category: "Navigation" },
  { keys: ["g", "f"], description: "Finances", category: "Navigation" },
  // Actions
  { keys: "?", description: "Afficher les raccourcis clavier", category: "Actions" },
];
