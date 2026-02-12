import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageDownloadSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="다운로드">
      <MypageDownloadSkeleton />
    </MypageLoadingShell>
  )
}
