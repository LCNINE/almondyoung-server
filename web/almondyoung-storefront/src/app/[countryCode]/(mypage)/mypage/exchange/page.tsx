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

interface ExchangePageProps {
  searchParams: Promise<{ orderId?: string; type?: string }>
}

export default async function ExchangePage({ searchParams }: ExchangePageProps) {
  const t = await getTranslations("mypage.menu")
  const { orderId, type } = await searchParams
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
        <ExchangeClient orderId={orderId} type={type === "exchange" ? "exchange" : "return"} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
