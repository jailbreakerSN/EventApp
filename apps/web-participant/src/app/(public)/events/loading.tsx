import { Skeleton } from "@teranga/shared-ui";
import { EventCardSkeleton } from "@/components/event-card-skeleton";

export default function EventsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Title skeleton */}
      <div className="mb-8">
        <Skeleton variant="text" className="h-8 w-48" />
        <Skeleton variant="text" className="mt-2 h-5 w-32" />
      </div>

      {/* Filter skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:items-center">
        <Skeleton variant="rectangle" className="h-10 sm:col-span-2 lg:flex-1 rounded-md" />
        <Skeleton variant="rectangle" className="h-10 rounded-md" />
        <Skeleton variant="rectangle" className="h-10 rounded-md" />
        <Skeleton variant="rectangle" className="h-10 rounded-md" />
        <Skeleton variant="rectangle" className="h-10 rounded-md" />
        <Skeleton variant="rectangle" className="h-10 rounded-md" />
      </div>

      {/* Grid skeleton — mirrors the editorial card grid (xl: 4 cols). */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <EventCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
