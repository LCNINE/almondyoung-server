import { UserDetail } from "domains/auth/types"
import { MENU_ITEMS, QUICK_LINKS } from "../constants/mypage-constants"
import { MenuList } from "./menu-list"
import { MobileHeader } from "./mobile-header"
import { PaymentBanner } from "./payment-banner"
import { PointsBanner } from "./points-banner"
import { QuickLinks } from "./quick-links"
import { SavingsBanner } from "./savings-banner"
import { ShippingItem } from "./shipping-item"

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
    <div className="bg-muted mx-auto space-y-4 px-4 py-4">
      <MobileHeader userName={currentUser?.username} />
      <SavingsBanner />
      <PointsBanner />
      <QuickLinks links={QUICK_LINKS} />
      <ShippingItem />
      <PaymentBanner />
      <MenuList items={MENU_ITEMS} />
    </div>
  )
}
