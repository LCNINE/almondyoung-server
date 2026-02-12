import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypagePasswordSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="비밀번호 변경">
      <MypagePasswordSkeleton />
    </MypageLoadingShell>
  )
}
