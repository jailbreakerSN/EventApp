"use client";

interface UsageMeterProps {
  label: string;
  current: number;
  // Accepts number | null | undefined: `Infinity` round-trips through JSON
  // as `null` (the API returns Infinity on unlimited plans, the wire turns
  // it into null), and the storage sentinel for unlimited is -1
  // (PLAN_LIMIT_UNLIMITED). Callers therefore never need to pre-normalise.
  limit: number | null | undefined;
  compact?: boolean;
}

export function UsageMeter({ label, current, limit, compact = false }: UsageMeterProps) {
  // `Number.isFinite` (strict) rejects null/undefined/NaN/±Infinity without
  // null→0 coercion, unlike the global `isFinite`. Negative or zero limits
  // (incl. the PLAN_LIMIT_UNLIMITED sentinel of -1) are treated as unlimited
  // so a misconfigured plan never renders a 100% red "Limite atteinte" meter.
  // The `Infinity` case happens in practice because the API returns Infinity
  // for unlimited plans and JSON.stringify converts it to `null` on the wire.
  const isUnlimited = !Number.isFinite(limit) || (limit as number) <= 0;
  const percent = isUnlimited
    ? 0
    : Math.min(Math.round((Math.max(0, current) / (limit as number)) * 100), 100);
  const color = percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-primary";

  const displayLimit: number | string = isUnlimited ? "\u221E" : (limit as number);

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
