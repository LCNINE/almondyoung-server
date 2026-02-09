import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ShopSettingTemplate } from "@/domains/shop-setting"
import { getShopSurvey } from "@/lib/api/users/shop-suvery"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "샵 설정",
  description: "샵 정보를 설정하세요",
}

export default async function ShopSettingPage() {
  const shopInfo = await getShopSurvey().catch(() => null)

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "샵 설정",
      }}
    >
      <MypageLayout>
        <ShopSettingTemplate shopInfo={shopInfo} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
