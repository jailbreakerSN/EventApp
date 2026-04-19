"use client";

import { useState, useEffect } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { cn } from "../lib/utils";

export interface ThemeToggleLabels {
  /** Accessible label for the whole toggle group. */
  group?: string;
  light?: string;
  dark?: string;
  system?: string;
}

interface ThemeToggleProps {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  className?: string;
  /**
   * Localised labels. `ThemeToggle` lives in framework-agnostic shared-ui
   * and has no access to next-intl; consumers pass the active locale's
   * labels down. Defaults to French to preserve the pre-i18n behaviour —
   * callers that want English / Wolof MUST pass their translated strings.
   */
  labels?: ThemeToggleLabels;
}

const DEFAULT_LABELS: Required<ThemeToggleLabels> = {
  group: "Thème de l'interface",
  light: "Clair",
  dark: "Sombre",
  system: "Système",
};

export function ThemeToggle({ theme, setTheme, className, labels }: ThemeToggleProps) {
  // Prevent hydration mismatch: theme is "system" on server but resolves
  // to "light"/"dark" on client. Only show active state after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const merged: Required<ThemeToggleLabels> = { ...DEFAULT_LABELS, ...labels };
  const options = [
    { value: "light", icon: Sun, label: merged.light },
    { value: "dark", icon: Moon, label: merged.dark },
    { value: "system", icon: Monitor, label: merged.system },
  ] as const;

  return (
    <div
      className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
      role="group"
      aria-label={merged.group}
    >
      {options.map(({ value, icon: Icon, label }) => {
        const isActive = mounted && theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label={label}
            aria-pressed={isActive}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
