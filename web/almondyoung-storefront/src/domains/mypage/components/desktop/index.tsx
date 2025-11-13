import { UserDetail } from "domains/auth/types"
import { PaymentInfoSection } from "./payment-info-section"
import { QuickMenuSection } from "./quick-menu-section"
import { RecommendedProductsSection } from "./recommended-products-section"
import { ShippingItemsSection } from "./shipping-items-section"
import { UserProfileSection } from "./user-profile-section"

/**
 * 마이페이지 데스크탑 콘텐츠
 *
 * 책임:
 * - 마이페이지 홈의 데스크탑 버전 UI 렌더링
 * - 데스크탑에 최적화된 섹션 구성
 */
interface MyPageDesktopContentProps {
  currentUser: UserDetail
}

export function MyPageDesktopContent({
  currentUser,
}: MyPageDesktopContentProps) {
  return (
    <div>
      <UserProfileSection
        userName={currentUser?.username}
        userId={currentUser?.id}
      />
      <QuickMenuSection  />
      <ShippingItemsSection />
      <PaymentInfoSection />
      <RecommendedProductsSection />
    </div>
  )
}
