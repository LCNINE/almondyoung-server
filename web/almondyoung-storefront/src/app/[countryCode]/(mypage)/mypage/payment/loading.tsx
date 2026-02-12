import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypagePaymentManagerSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="결제수단 관리">
      <MypagePaymentManagerSkeleton />
    </MypageLoadingShell>
  )
}
