"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISSED_KEY = "teranga-pwa-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type BannerMode = "android" | "ios" | null;

export function PwaInstallBanner() {
  const [mode, setMode] = useState<BannerMode>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      return;
    }

    // Already installed in standalone mode
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);

    if (isIOS) {
      // Only prompt on Safari — Chrome/Firefox iOS can't install PWAs
      const isSafari = /^(?!.*Chrome).*Safari/.test(ua);
      if (isSafari) setMode("ios");
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
    setMode(null);
  };

  if (!mode) return null;

  return (
    <div
      role="dialog"
      aria-label="Installer l'application Teranga"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-2xl bg-teranga-navy p-4 text-white shadow-xl animate-in slide-in-from-bottom-4 duration-300"
    >
      <button
        onClick={dismiss}
        aria-label="Fermer"
        className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/10 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="shrink-0 h-12 w-12 rounded-xl bg-teranga-gold flex items-center justify-center">
          <span className="font-bold text-teranga-navy text-lg leading-none">T</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Installer Teranga</p>

          {mode === "android" ? (
            <>
              <p className="text-xs text-white/70 mt-0.5">
                Accédez rapidement aux événements, même hors ligne.
              </p>
              <button
                onClick={handleInstall}
                className="mt-3 inline-flex items-center gap-1.5 bg-teranga-gold text-teranga-navy rounded-full px-4 py-1.5 text-xs font-semibold hover:bg-teranga-gold/80 transition-colors"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Installer
              </button>
            </>
          ) : (
            <p className="text-xs text-white/70 mt-0.5 leading-relaxed">
              Appuyez sur{" "}
              <Share className="h-3.5 w-3.5 inline-block align-middle mx-0.5" aria-label="le bouton Partager" />
              {" "}puis <strong className="text-white">Ajouter à l&apos;écran d&apos;accueil</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
