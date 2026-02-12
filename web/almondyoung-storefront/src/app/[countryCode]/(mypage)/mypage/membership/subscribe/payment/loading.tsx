import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageMembershipSubscribePaymentSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="멤버십 구독">
      <MypageMembershipSubscribePaymentSkeleton />
    </MypageLoadingShell>
  )
}
