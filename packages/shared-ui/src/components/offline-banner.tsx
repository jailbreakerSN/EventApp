"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";
import { DEFAULT_UI_LOCALE_FR, type OfflineBannerLabels } from "../lib/i18n";

export interface OfflineBannerProps {
  /** Localised labels; unspecified keys fall back to French. */
  labels?: Partial<OfflineBannerLabels>;
}

function OfflineBanner({ labels }: OfflineBannerProps = {}) {
  const [isOffline, setIsOffline] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);
  const l = { ...DEFAULT_UI_LOCALE_FR.offlineBanner, ...labels };

  React.useEffect(() => {
    // Check initial state
    if (!navigator.onLine) {
      setIsOffline(true);
      setIsVisible(true);
    }

    const handleOffline = () => {
      setIsOffline(true);
      setIsVisible(true);
    };

    const handleOnline = () => {
      setIsOffline(false);
      // Delay hiding for fade-out transition
      setTimeout(() => setIsVisible(false), 300);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 transition-opacity duration-300 ${
        isOffline ? "opacity-100" : "opacity-0"
      }`}
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>{l.message}</span>
    </div>
  );
}

export { OfflineBanner };
