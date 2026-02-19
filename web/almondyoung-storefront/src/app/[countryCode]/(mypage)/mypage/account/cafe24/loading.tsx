import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageCafe24Skeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="카페24 연동">
      <MypageCafe24Skeleton />
    </MypageLoadingShell>
  )
}
