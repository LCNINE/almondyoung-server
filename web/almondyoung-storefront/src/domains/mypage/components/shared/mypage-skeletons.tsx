import { Skeleton } from "@/components/ui/skeleton"

/**
 * 마이페이지 홈(데스크탑)에 임베드되는 주문목록 스켈레톤.
 * OrderList(embedded) 레이아웃과 맞춘다: 타이틀 + 검색 + 기간 pill + 주문 카드.
 */
export function MypageHomeOrderListSkeleton() {
  return (
    <div className="md:bg-transparent">
      {/* 타이틀 + 검색 + 기간 pill */}
      <div className="space-y-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-11 w-full max-w-xl rounded-lg" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton
              key={`order-period-${index}`}
              className="h-7 w-16 rounded-full"
            />
          ))}
        </div>
      </div>

      {/* 주문 카드 */}
      <section className="mt-4 space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`order-card-skeleton-${index}`}
            className="rounded-[10px] border border-gray-200 bg-white p-5"
          >
            <div className="mb-5 flex items-start justify-between">
              <div className="space-y-1">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="mb-3 h-5 w-24" />
            <div className="flex items-start gap-4">
              <Skeleton className="h-20 w-20 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <div className="hidden w-40 flex-col gap-2 md:flex">
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

/**
 * 주문 내역 가로 카드 스켈레톤 (모바일)
 */
export function ShippingStatusSkeleton() {
  return (
    <section className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-14" />
      </div>
      <div className="-mx-6 flex gap-3 overflow-hidden px-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={`shipping-mobile-skeleton-${index}`}
            className="w-[160px] shrink-0 rounded-lg border border-[#ececec] bg-white p-3.5"
          >
            <Skeleton className="mb-2 h-4 w-2/3" />
            <Skeleton className="aspect-square w-full rounded-md" />
          </div>
        ))}
      </div>
    </section>
  )
}
