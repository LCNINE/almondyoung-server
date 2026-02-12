import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageRecentSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="최근 본 상품">
      <MypageRecentSkeleton />
    </MypageLoadingShell>
  )
}
