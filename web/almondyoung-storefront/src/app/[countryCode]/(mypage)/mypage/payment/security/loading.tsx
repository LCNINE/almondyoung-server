import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypagePinSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="비밀번호 설정">
      <MypagePinSkeleton />
    </MypageLoadingShell>
  )
}
