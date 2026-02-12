import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageWishlistSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="찜한 상품">
      <MypageWishlistSkeleton />
    </MypageLoadingShell>
  )
}
