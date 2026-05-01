import { MypageLoadingShell } from "@/components/skeletons/mypage-loading-shell"
import { MypageShopSettingSkeleton } from "@/components/skeletons/page-skeletons"

export default function Loading() {
  return (
    <MypageLoadingShell title="쇼핑 설정">
      <MypageShopSettingSkeleton />
    </MypageLoadingShell>
  )
}
