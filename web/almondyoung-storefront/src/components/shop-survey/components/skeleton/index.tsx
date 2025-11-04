import { Skeleton } from "@components/common/ui/skeleton"

export default function ShopSurveySkeleton() {
  return (
    <div className="flex flex-col gap-10 p-2">
      {/* 헤더 스켈레톤 */}
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* 진행 상태 바 스켈레톤 */}
      <div className="flex gap-2">
        <Skeleton className="h-2 flex-1" />
        <Skeleton className="h-2 flex-1" />
        <Skeleton className="h-2 flex-1" />
      </div>

      {/* 폼 콘텐츠 스켈레톤 */}
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>

        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>

      {/* 버튼 스켈레톤 */}
      <div className="flex justify-end gap-3">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-20" />
      </div>
    </div>
  )
}
