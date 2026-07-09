import { Skeleton } from "@/components/ui/skeleton"

/**
 * 배송 중 상품 섹션 스켈레톤 (데스크탑)
 */
export function ShippingItemsSkeleton() {
  return (
    <section
      aria-labelledby="shipping-items-heading"
      className="bg-background mt-6 rounded-lg p-8"
    >
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`shipping-skeleton-${index}`} className="flex gap-4">
            <Skeleton className="h-20 w-20 rounded-md" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </section>
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
