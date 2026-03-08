import { Skeleton } from "../ui/skeleton"

export function SidebarSkeleton() {
  return (
    <div className="sticky top-4 hidden w-full max-w-60 min-w-56 flex-col items-start gap-7 rounded-2xl border border-gray-300 px-7 py-10 md:flex">
      <Skeleton className="h-6 w-24" />
      <div className="flex w-full flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  )
}
