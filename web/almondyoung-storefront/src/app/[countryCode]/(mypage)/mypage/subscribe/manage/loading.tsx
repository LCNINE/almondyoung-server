import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { GenericPageSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="정기구독 관리">
      <GenericPageSkeleton />
    </MypageLoadingShell>
  )
}
