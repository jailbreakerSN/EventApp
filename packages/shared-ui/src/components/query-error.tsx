import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "./button";
import { cn } from "../lib/utils";

export interface QueryErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

function QueryError({
  title = "Erreur de chargement",
  message = "Une erreur est survenue lors du chargement des données.",
  onRetry,
  className,
}: QueryErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-border bg-card p-12 text-center",
        className,
      )}
    >
      <AlertCircle className="mb-4 h-12 w-12 text-destructive/70" />
      <h3 className="mb-1 text-lg font-semibold text-destructive">{title}</h3>
      <p className="mb-4 max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export { QueryError };
