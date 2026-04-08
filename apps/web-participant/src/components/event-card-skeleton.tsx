import { Skeleton } from "@teranga/shared-ui";

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      {/* Image placeholder */}
      <Skeleton variant="rectangle" className="aspect-[16/9] h-auto w-full rounded-none" />

      <div className="p-4">
        {/* Title — 2 lines */}
        <Skeleton variant="text" className="h-5 w-full" />
        <Skeleton variant="text" className="mt-1.5 h-5 w-3/4" />

        {/* Date */}
        <div className="mt-3 flex items-center gap-1.5">
          <Skeleton variant="circle" className="h-3.5 w-3.5" />
          <Skeleton variant="text" className="h-3.5 w-32" />
        </div>

        {/* Location */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <Skeleton variant="circle" className="h-3.5 w-3.5" />
          <Skeleton variant="text" className="h-3.5 w-40" />
        </div>

        {/* Price + attendees */}
        <div className="mt-3 flex items-center justify-between">
          <Skeleton variant="text" className="h-4 w-24" />
          <Skeleton variant="text" className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}
