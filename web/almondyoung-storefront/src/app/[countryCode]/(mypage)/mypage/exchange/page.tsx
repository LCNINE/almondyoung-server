import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import { ExchangeClient } from "../../../../../domains/order/exchange/exchange-client"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({
    title: t("exchange"),
    openGraph: {},
  })
}

export default async function ExchangePage() {
  const t = await getTranslations("mypage.menu")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("exchange"),
      }}
    >
      <MypageLayout>
        <ExchangeClient />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
