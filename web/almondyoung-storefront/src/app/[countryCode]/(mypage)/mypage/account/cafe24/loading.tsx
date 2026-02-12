import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageCafe24Skeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="기존 아몬드영 계정 연결/이관">
      <MypageCafe24Skeleton />
    </MypageLoadingShell>
  )
}
