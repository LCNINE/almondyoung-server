import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageEmptyStateSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="구독 관리">
      <MypageEmptyStateSkeleton />
    </MypageLoadingShell>
  )
}
