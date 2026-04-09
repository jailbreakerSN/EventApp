import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full text-center">
        <SearchX className="mx-auto h-16 w-16 text-muted-foreground/50 mb-6" />
        <p className="text-6xl font-bold text-foreground mb-4">404</p>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          Page introuvable
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          {
            "La page que vous recherchez n\u2019existe pas ou a \u00e9t\u00e9 d\u00e9plac\u00e9e."
          }
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
