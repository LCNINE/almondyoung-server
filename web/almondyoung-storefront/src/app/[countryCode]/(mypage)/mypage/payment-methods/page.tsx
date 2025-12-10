import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import { PaymentMethodsList } from "domains/payment-methods"

// 레거시 - 지울 예정 하위 PaymentMethodsList 컴포넌트들도 삭제할 예정
export default function PaymentManagePage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "결제수단 관리",
      }}
    >
      <MypageLayout>
        <PaymentMethodsList />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
