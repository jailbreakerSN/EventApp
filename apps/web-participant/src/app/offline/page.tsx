import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = {
  title: "Hors ligne",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full text-center">
        <WifiOff className="mx-auto h-16 w-16 text-muted-foreground/50 mb-6" />
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {"Vous \u00eates hors ligne"}
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          {"V\u00e9rifiez votre connexion internet et r\u00e9essayez."}
        </p>
        <RetryButton />
      </div>
    </div>
  );
}
