import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageOrderTrackSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="배송 조회">
      <MypageOrderTrackSkeleton />
    </MypageLoadingShell>
  )
}
