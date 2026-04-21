import { Skeleton } from "@teranga/shared-ui";

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border bg-card">
      {/* Cover placeholder — matches EditorialEventCard's 16/10 ratio. */}
      <Skeleton variant="rectangle" className="aspect-[16/10] h-auto w-full rounded-none" />

      <div className="flex flex-col gap-3.5 p-6">
        <div className="flex items-center justify-between">
          <Skeleton variant="text" className="h-3 w-24" />
          <Skeleton variant="text" className="h-3 w-16" />
        </div>
        {/* Title — 2 lines */}
        <Skeleton variant="text" className="h-5 w-full" />
        <Skeleton variant="text" className="h-5 w-3/4" />
        {/* Registered line */}
        <Skeleton variant="text" className="h-3.5 w-32" />
        <div className="mt-1 flex items-center justify-between">
          <Skeleton variant="text" className="h-4 w-24" />
          <Skeleton variant="circle" className="h-10 w-10" />
        </div>
      </div>
    </div>
  );
}
