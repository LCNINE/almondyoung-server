import { Skeleton } from "@/components/ui/skeleton"

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-3/4 w-full bg-gray-200" />
      <div className="flex flex-col gap-1 px-1">
        <Skeleton className="h-4 w-4/5 bg-gray-200" />
        <Skeleton className="h-4 w-3/5 bg-gray-200" />
        <Skeleton className="h-3 w-2/5 bg-gray-200" />
      </div>
    </div>
  )
}

export function ProductSectionSkeleton() {
  return (
    <>
      {/* mobile */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-8 px-1 md:hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={`mobile-${i}`} />
        ))}
      </div>

      {/* desktop */}
      <div className="hidden md:grid md:grid-cols-4 md:gap-x-3 md:gap-y-8 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonCard key={`desktop-${i}`} />
        ))}
      </div>
    </>
  )
}
