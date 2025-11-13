import { UserDetail } from "domains/auth/types"
import { MENU_ITEMS } from "../constants/mypage-constants"
import { MenuList } from "./menu-list"
import { MobileHeader } from "./mobile-header"
import { PointsBanner } from "./points-banner"
import { QuickLinks } from "./quick-links"
import { SavingsBanner } from "./savings-banner"
import ShippingStatusCard from "./shipping-status-card"
import PayLaterBanner from "./paylater-banner"

/**
 * 마이페이지 모바일 콘텐츠
 *
 * 책임:
 * - 마이페이지 홈의 모바일 버전 UI 렌더링
 * - 모바일에 최적화된 섹션 구성
 */
interface MyPageMobileContentProps {
  currentUser: UserDetail
}

export function MyPageMobileContent({ currentUser }: MyPageMobileContentProps) {
  return (
    <div className="mx-auto">
      <div className="bg-muted space-y-4 px-6 py-4">
        <MobileHeader userName={currentUser?.username} />
        <SavingsBanner />
        <PointsBanner />
        <QuickLinks />
      </div>
      <div className="space-y-4 bg-white px-4 py-4">
        <ShippingStatusCard />
      </div>
      <PayLaterBanner />
      <MenuList items={MENU_ITEMS} />
    </div>
  )
}
