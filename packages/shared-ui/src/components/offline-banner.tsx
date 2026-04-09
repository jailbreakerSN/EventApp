"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";

function OfflineBanner() {
  const [isOffline, setIsOffline] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);

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
      <span>{"Connexion perdue. Certaines fonctionnalit\u00e9s peuvent \u00eatre indisponibles."}</span>
    </div>
  );
}

export { OfflineBanner };
