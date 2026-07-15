import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import MembershipBenefitsGuide from "@/domains/membership/home/components/non-subscriber/membership-benefits-guide"
import { WithHeaderLayout } from "@components/layout"
import { getCurrentSubscription } from "@lib/api/membership"
import { getTranslations } from "next-intl/server"

export default async function MembershipBenefitsPage() {
  const t = await getTranslations("mypage.membership")
  const subscription = await getCurrentSubscription().catch(() => null)
  const isMember = !!subscription

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("benefits.guideTitle"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          {/* 이미 회원이면 구독하기 CTA 숨김 */}
          <MembershipBenefitsGuide showSubscribeCta={!isMember} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
