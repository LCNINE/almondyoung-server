import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ShopListingFormView } from "@/domains/shop-trade/components/listing-form"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("shopTrade.form")
  return getSEOTags({ title: t("newTitle"), openGraph: {}, extraTags: {} })
}

export default async function NewShopListingPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const t = await getTranslations("shopTrade.form")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("newTitle"),
      }}
    >
      <MypageLayout>
        <ShopListingFormView countryCode={countryCode} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
