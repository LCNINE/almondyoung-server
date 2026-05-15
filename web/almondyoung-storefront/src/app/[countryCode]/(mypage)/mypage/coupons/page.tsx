import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@/components/layout"
import { CouponTemplate } from "@/domains/mypage/template/coupon/coupon-template"

export default function CouponPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "내 쿠폰",
      }}
    >
      <MypageLayout>
        <CouponTemplate />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
