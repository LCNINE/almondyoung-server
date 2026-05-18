import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ShopSettingTemplate } from "@/domains/shop-setting"
import { getShopSurvey } from "@/lib/api/users/shop-suvery"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.shopSetting")
  return { title: t("pageTitle") }
}

export default async function ShopSettingPage() {
  const t = await getTranslations("mypage.shopSetting")
  const shopInfo = await getShopSurvey().catch(() => null)

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
        <ShopSettingTemplate shopInfo={shopInfo} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
