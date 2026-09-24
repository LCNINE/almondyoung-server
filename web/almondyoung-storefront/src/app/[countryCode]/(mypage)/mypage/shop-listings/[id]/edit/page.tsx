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
  const tMine = await getTranslations("shopTrade.mine")
  const result = await getMyShopListing(id)

  if (result.ok && result.data.status === "hidden") {
    // 숨긴 글은 수정할 수 없다(spec §7.3) — 존재는 새지 않게 남의 글·지운 글과 같은 404 로 막는다.
    notFound()
  }
  if (!result.ok) {
    if (result.status === 401) {
      // 루트 error.tsx 가 토큰을 복구한다 — CLAUDE.md §6
      throw new Error("UNAUTHORIZED")
    }
    // 남의 글·지운 글은 서버가 404 로 존재를 숨긴다. 그 밖(5xx·네트워크)은 새로고침을 안내한다 —
    // 없는 글로 오인시키지 않는다.
    if (result.status === 404) notFound()
  }

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
        {result.ok ? (
          <ShopListingFormView listing={result.data} countryCode={countryCode} />
        ) : (
          <p className="text-muted-foreground py-16 text-center text-sm">{tMine("loadFail")}</p>
        )}
      </MypageLayout>
    </WithHeaderLayout>
  )
}
