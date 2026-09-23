import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { MyListings } from "@/domains/shop-trade/components/my-listings"
import { listMyShopListings } from "@/lib/api/ugc/my-shop-listings"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({ title: t("myShopListings"), openGraph: {}, extraTags: {} })
}

export default async function MyShopListingsPage() {
  const tMenu = await getTranslations("mypage.menu")
  const t = await getTranslations("shopTrade.mine")
  const result = await listMyShopListings()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: tMenu("myShopListings"),
      }}
    >
      <MypageLayout>
        <div className="px-4 py-6 md:px-0">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-foreground text-lg font-bold">{t("title")}</h1>
            {result.ok && result.data.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <LocalizedClientLink href="/mypage/shop-listings/new">
                  {t("register")}
                </LocalizedClientLink>
              </Button>
            )}
          </div>

          {result.ok ? (
            <MyListings items={result.data} />
          ) : (
            <p className="text-muted-foreground py-16 text-center text-sm">
              {t("loadFail")}
            </p>
          )}
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
