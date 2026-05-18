import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import PaymentManager from "domains/payment/payment-management"

export default async function PaymentPage() {
  const t = await getTranslations("mypage.page")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("paymentSettings"),
      }}
    >
      <MypageLayout>
        <PaymentManager />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
