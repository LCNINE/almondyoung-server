import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import PaymentManager from "domains/payment/payment-management"

export default function PaymentPage() {
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
        <PaymentManager />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
