import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypagePointSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="포인트 적립">
      <MypagePointSkeleton />
    </MypageLoadingShell>
  )
}
