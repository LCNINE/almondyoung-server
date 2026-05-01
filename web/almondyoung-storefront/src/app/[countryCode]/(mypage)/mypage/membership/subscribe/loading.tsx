import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageEmptyStateSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="멤버십 가입">
      <MypageEmptyStateSkeleton />
    </MypageLoadingShell>
  )
}
