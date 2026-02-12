import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageRebuySkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="자주 산 상품">
      <MypageRebuySkeleton />
    </MypageLoadingShell>
  )
}
