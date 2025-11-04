import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import { PaymentMethodsList } from "domains/payment-methods"

export default function PaymentManagePage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      <MypageLayout>
        <PaymentMethodsList />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
