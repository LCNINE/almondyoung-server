import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import MembershipPaymentMethodContent from "./content"

export default async function MembershipPaymentMethodPage() {
  const t = await getTranslations("mypage.membershipPaymentMethod")

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("pageTitle"),
      }}
    >
      <MypageLayout>
        <MembershipPaymentMethodContent />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
