import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageHomeSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell showMobileSubBackHeader={false}>
      <MypageHomeSkeleton />
    </MypageLoadingShell>
  )
}
