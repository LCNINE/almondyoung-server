import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageReviewsSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="리뷰 목록">
      <MypageReviewsSkeleton />
    </MypageLoadingShell>
  )
}
