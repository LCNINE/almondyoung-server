import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageProfileSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="회원정보 수정">
      <MypageProfileSkeleton />
    </MypageLoadingShell>
  )
}
