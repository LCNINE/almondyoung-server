import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { PageTitle } from "@/components/shared/page-title"
import { RecentContainerSkeleton } from "./recent-container"

export default function Loading() {
  return (
    <MypageLoadingShell title="최근 본 상품">
      <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
        <PageTitle>최근 본 상품</PageTitle>
        <RecentContainerSkeleton />
      </div>
    </MypageLoadingShell>
  )
}
