import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@/components/layout"
import { CouponTemplate } from "@/domains/mypage/template/coupon/coupon-template"
import { getTranslations } from "next-intl/server"

export default async function CouponPage() {
  const t = await getTranslations("mypage.coupon")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("myCoupons"),
      }}
    >
      <MypageLayout>
        <CouponTemplate />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
