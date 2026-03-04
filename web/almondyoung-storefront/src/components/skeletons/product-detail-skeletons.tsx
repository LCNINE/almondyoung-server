import { Skeleton } from "@/components/ui/skeleton"

export function ProductDetailInfoSkeleton() {
  return (
    <div className="space-y-8">
      {/* 상품정보 테이블 */}
      <div>
        <Skeleton className="mb-4 h-6 w-20" />
        <div className="grid grid-cols-2 gap-x-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border-b py-3">
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
          {/* 소재, 사용방법 - 전체 너비 */}
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={`full-${i}`} className="col-span-2 border-b py-3">
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* 상세 이미지 영역 */}
      <Skeleton className="aspect-square w-full rounded-lg" />
    </div>
  )
}

export function ProductReviewSkeleton() {
  return (
    <div className="space-y-4 py-6">
      <Skeleton className="h-4 w-40" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`review-skeleton-${index}`}
            className="rounded-lg border border-gray-100 p-4"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProductQnaSkeleton() {
  return (
    <div className="space-y-4 py-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={`qna-skeleton-${i}`} className="py-6">
          <div className="space-y-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RatingSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-1.5 py-1">
      <div className="flex gap-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-gray-10 h-4 w-4 rounded-sm" />
        ))}
      </div>
      <div className="bg-gray-10 h-4 w-6 rounded" />
      <div className="bg-gray-10 h-4 w-px" />
      <div className="bg-gray-10 h-4 w-16 rounded" />
    </div>
  )
}
