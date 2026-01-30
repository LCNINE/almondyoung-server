import type { UserDetail } from "@lib/types/ui/user"
import { PaymentInfoSection } from "./payment-info-section"
import { QuickMenuSection } from "./quick-menu-section"
import { RecommendedProductsSection } from "./recommended-products-section"
import { ShippingItemsSection } from "./shipping-items-section"
import { UserProfileSection } from "./user-profile-section"
import { AdminAccessButton } from "@/components/admin/admin-access-button"

/**
 * 마이페이지 데스크탑 콘텐츠
 *
 * 책임:
 * - 마이페이지 홈의 데스크탑 버전 UI 렌더링
 * - 데스크탑에 최적화된 섹션 구성
 */
interface MyPageDesktopContentProps {
  currentUser: UserDetail
  isAdmin?: boolean
  countryCode?: string
}

export function MyPageDesktopContent({
  currentUser,
  isAdmin = false,
  countryCode = "kr",
}: MyPageDesktopContentProps) {
  return (
    <div>
      <UserProfileSection userName={currentUser?.username} />

      {/* 관리자 버튼 */}
      {isAdmin && (
        <div className="mb-4">
          <AdminAccessButton countryCode={countryCode} />
        </div>
      )}

      <QuickMenuSection />
      <ShippingItemsSection />
      <PaymentInfoSection />
      <RecommendedProductsSection />
    </div>
  )
}
