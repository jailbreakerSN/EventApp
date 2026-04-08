"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      // Sonner renders toasts inside a <ol> with role="region" and aria-label.
      // We set the accessible label in French for screen readers.
      toastOptions={{
        duration: 4000,
        className: "text-sm",
      }}
      aria-label="Notifications"
    />
  );
}
