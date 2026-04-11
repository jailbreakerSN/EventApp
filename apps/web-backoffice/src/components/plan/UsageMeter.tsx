"use client";

interface UsageMeterProps {
  label: string;
  current: number;
  limit: number;
  compact?: boolean;
}

export function UsageMeter({ label, current, limit, compact = false }: UsageMeterProps) {
  const isUnlimited = !isFinite(limit);
  const percent = isUnlimited ? 0 : Math.min(Math.round((current / limit) * 100), 100);
  const color = percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-primary";

  const displayLimit = isUnlimited ? "\u221E" : limit;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground w-20 truncate">{label}</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: isUnlimited ? "0%" : `${percent}%` }}
          />
        </div>
        <span className="text-muted-foreground tabular-nums w-12 text-right">
          {current}/{displayLimit}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums">
          {current}/{displayLimit}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: isUnlimited ? "0%" : `${percent}%` }}
        />
      </div>
      {percent >= 80 && !isUnlimited && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
          {percent >= 100 ? "Limite atteinte" : `${percent}% utilisé`}
        </p>
      )}
    </div>
  );
}
