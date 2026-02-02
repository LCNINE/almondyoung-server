import type { UserDetail } from "@lib/types/ui/user"
import { MENU_ITEMS } from "../constants/mypage-constants"
import { MenuList } from "./menu-list"
import { MobileHeader } from "./mobile-header"
import { PointsBanner } from "./points-banner"
import { QuickLinks } from "./quick-links"
import { SavingsBanner } from "./savings-banner"
import ShippingStatusCard from "./shipping-status-card"
import { AdminAccessButton } from "@/components/admin/admin-access-button"
// import PayLaterBanner from "./paylater-banner"

/**
 * 마이페이지 모바일 콘텐츠
 *
 * 책임:
 * - 마이페이지 홈의 모바일 버전 UI 렌더링
 * - 모바일에 최적화된 섹션 구성
 */
interface MyPageMobileContentProps {
  currentUser: UserDetail
  isAdmin?: boolean
  countryCode?: string
}

export function MyPageMobileContent({
  currentUser,
  isAdmin = false,
  countryCode = "kr",
}: MyPageMobileContentProps) {
  return (
    <div className="mx-auto">
      <div className="bg-muted space-y-4 px-6 py-4">
        <MobileHeader userName={currentUser?.username} />

        {/* 관리자 버튼 */}
        {isAdmin && (
          <div className="pb-2">
            <AdminAccessButton
              countryCode={countryCode}
              className="w-full"
            />
          </div>
        )}

        <SavingsBanner />
        <PointsBanner />
        <QuickLinks />
      </div>
      <div className="space-y-4 bg-white px-4 py-4">
        <ShippingStatusCard />
      </div>
      {/* todo: 페이라터 배너 임시 비활성화 */}
      {/* <PayLaterBanner /> */}
      <MenuList items={MENU_ITEMS} />
    </div>
  )
}
