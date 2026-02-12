import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageExchangeSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="취소/교환/반품">
      <MypageExchangeSkeleton />
    </MypageLoadingShell>
  )
}
