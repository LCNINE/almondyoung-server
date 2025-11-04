import { UserProfileSection } from "./user-profile-section"
import { QuickMenuSection } from "./quick-menu-section"
import { ShippingItemsSection } from "./shipping-items-section"
import { PaymentInfoSection } from "./payment-info-section"
import { RecommendedProductsSection } from "./recommended-products-section"
import { QUICK_LINKS } from "../constants/mypage-constants"

/**
 * 마이페이지 데스크탑 콘텐츠
 *
 * 책임:
 * - 마이페이지 홈의 데스크탑 버전 UI 렌더링
 * - 데스크탑에 최적화된 섹션 구성
 */
interface MyPageDesktopContentProps {
  userName: string
}

export function MyPageDesktopContent({ userName }: MyPageDesktopContentProps) {
  return (
    <div>
      <UserProfileSection userName={userName} />
      <QuickMenuSection items={QUICK_LINKS} />
      <ShippingItemsSection />
      <PaymentInfoSection />
      <RecommendedProductsSection />
    </div>
  )
}
