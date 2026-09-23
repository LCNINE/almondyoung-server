import { notFound } from "next/navigation"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ShopListingFormView } from "@/domains/shop-trade/components/listing-form"
import { getMyShopListing } from "@/lib/api/ugc/my-shop-listings"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("shopTrade.form")
  return getSEOTags({ title: t("editTitle"), openGraph: {}, extraTags: {} })
}

export default async function EditShopListingPage({
  params,
}: {
  params: Promise<{ countryCode: string; id: string }>
}) {
  const { countryCode, id } = await params
  const t = await getTranslations("shopTrade.form")
  const result = await getMyShopListing(id)

  // 남의 글·지운 글은 서버가 404 로 존재를 숨긴다(spec §7.3). 숨긴 글은 수정할 수 없으니 여기서도 막는다.
  if (!result.ok || result.data.status === "hidden") notFound()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("editTitle"),
      }}
    >
      <MypageLayout>
        <ShopListingFormView listing={result.data} countryCode={countryCode} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
