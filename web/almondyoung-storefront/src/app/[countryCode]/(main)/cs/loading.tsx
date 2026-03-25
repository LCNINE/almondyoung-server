import { Skeleton } from "@/components/ui/skeleton"

export default function CsLoading() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-4">
        <Skeleton className="mx-auto h-6 w-24" />
      </div>

      <div className="mx-auto max-w-3xl bg-white">
        {/* Tabs */}
        <div className="flex h-12 items-center justify-center gap-8 border-b border-gray-200">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>

        {/* Content */}
        <div className="px-4 py-6">
          <div className="mb-6">
            <Skeleton className="mb-2 h-6 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>

          <div className="space-y-4">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
