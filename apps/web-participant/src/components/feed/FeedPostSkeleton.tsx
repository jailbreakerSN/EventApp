import { Skeleton } from "@teranga/shared-ui";

export function FeedPostSkeleton() {
  return (
    <div className="bg-card rounded-card border border-border p-5 space-y-4">
      {/* Header: avatar + name + date */}
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" className="h-10 w-10" />
        <div className="flex-1 space-y-1.5">
          <Skeleton variant="text" className="h-3.5 w-32" />
          <Skeleton variant="text" className="h-3 w-20" />
        </div>
      </div>

      {/* Content lines */}
      <div className="space-y-2">
        <Skeleton variant="text" className="h-3.5 w-full" />
        <Skeleton variant="text" className="h-3.5 w-full" />
        <Skeleton variant="text" className="h-3.5 w-3/4" />
      </div>

      {/* Potential image area */}
      <Skeleton variant="rectangle" className="h-48 w-full" />

      {/* Action bar */}
      <div className="flex items-center gap-4 border-t border-border pt-3">
        <Skeleton variant="text" className="h-4 w-16" />
        <Skeleton variant="text" className="h-4 w-16" />
      </div>
    </div>
  );
}
