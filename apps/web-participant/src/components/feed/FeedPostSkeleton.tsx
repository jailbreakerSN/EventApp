function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded-md ${className}`} />;
}

export function FeedPostSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      {/* Header: avatar + name + date */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>

      {/* Content lines */}
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>

      {/* Potential image area */}
      <Skeleton className="h-48 w-full rounded-lg" />

      {/* Action bar */}
      <div className="flex items-center gap-4 border-t border-border pt-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}
