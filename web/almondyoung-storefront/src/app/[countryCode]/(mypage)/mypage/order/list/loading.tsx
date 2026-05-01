import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageOrderListSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="주문내역">
      <MypageOrderListSkeleton />
    </MypageLoadingShell>
  )
}
