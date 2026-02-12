import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { OrderDetailsSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell>
      <OrderDetailsSkeleton />
    </MypageLoadingShell>
  )
}
