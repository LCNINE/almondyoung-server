import { Skeleton } from "@/components/ui/skeleton"

const SKELETON_COUNT = 12

function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {/* 상품 이미지 */}
      <Skeleton className="aspect-square w-full rounded-lg" />
      {/* 상품명 */}
      <Skeleton className="h-4 w-3/4" />
      {/* 가격 */}
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

export function ProductsSkeleton() {
  return (
    <ul className="grid w-full grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <li key={i}>
          <ProductCardSkeleton />
        </li>
      ))}
    </ul>
  )
}
