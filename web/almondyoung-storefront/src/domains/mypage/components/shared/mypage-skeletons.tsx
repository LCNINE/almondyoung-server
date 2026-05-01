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
 * 결제 정보 섹션 스켈레톤 (데스크탑)
 */
export function PaymentInfoSkeleton() {
  return (
    <section className="self-stretch bg-white">
      <div className="flex flex-col items-center justify-center gap-4 py-6 pl-7">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-48 rounded-[5px]" />
      </div>
    </section>
  )
}

/**
 * 절약 배너 스켈레톤 (모바일)
 */
export function SavingsBannerSkeleton() {
  return (
    <section className="flex items-center justify-between rounded-lg bg-yellow-100 p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-12 rounded bg-purple-200" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-5 w-5" />
    </section>
  )
}

/**
 * 포인트 배너 스켈레톤 (모바일)
 */
export function PointsBannerSkeleton() {
  return (
    <section className="flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-3.5 shadow-sm">
      <Skeleton className="h-3 w-32" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-4 rounded-full" />
      </div>
    </section>
  )
}

/**
 * 배송 상태 카드 스켈레톤 (모바일)
 */
export function ShippingStatusSkeleton() {
  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="text-base font-bold text-black">배송 중 상품</h2>
      <div className="flex flex-col gap-4 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white px-4 py-3.5">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={`shipping-mobile-skeleton-${index}`}
              className="flex items-center gap-4"
            >
              <Skeleton className="h-[45px] w-11 rounded-[5px]" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
