import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageMembershipSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="아몬드영 멤버십">
      <MypageMembershipSkeleton />
    </MypageLoadingShell>
  )
}
