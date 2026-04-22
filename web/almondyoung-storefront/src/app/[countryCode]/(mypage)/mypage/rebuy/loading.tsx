import { PageTitle } from "@/components/shared/page-title"
import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { ProductsSkeleton } from "@/components/skeletons/products-skeleton"

export default function Loading() {
  return (
    <MypageLoadingShell title="자주 산 상품">
      <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
        <PageTitle>자주 산 상품</PageTitle>
        <ProductsSkeleton />
      </div>
    </MypageLoadingShell>
  )
}
