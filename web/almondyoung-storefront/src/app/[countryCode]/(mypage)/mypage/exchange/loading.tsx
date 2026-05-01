import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageExchangeSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="교환/환불">
      <MypageExchangeSkeleton />
    </MypageLoadingShell>
  )
}
