import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderDetailsDesktop } from "domains/order/details/components/order-details-desktop"
import { OrderDetailsMobile } from "domains/order/details/components/order-details-mobile"

/**
 * 주문 상세 페이지 (반응형)
 *
 * 모바일과 데스크탑이 완전히 다른 UI이므로 조건부 렌더링으로 처리
 * - 모바일: lg 미만 화면에서 표시
 * - 데스크탑: lg 이상 화면에서 표시
 */
export default function OrderDetailsPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      {/* 데스크탑 버전 - lg 이상에서만 표시 */}
      <div className="hidden lg:block">
        <MypageLayout>
          <OrderDetailsDesktop />
        </MypageLayout>
      </div>

      {/* 모바일 버전 - lg 미만에서만 표시 */}
      <div className="lg:hidden">
        <OrderDetailsMobile />
      </div>
    </WithHeaderLayout>
  )
}
