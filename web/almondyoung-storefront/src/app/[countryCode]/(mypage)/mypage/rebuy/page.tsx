import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { fetchFrequentProducts } from "@/domains/frequent-products/actions"
import { FrequentProductsTemplate } from "@/domains/frequent-products/templates"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("rebuy") }
}

const ITEMS_PER_PAGE = 12

interface RebuyPageProps {
  params: Promise<{
    countryCode: string
  }>
  searchParams: Promise<{
    page?: string
  }>
}

export default async function RebuyPage({
  params,
  searchParams,
}: RebuyPageProps) {
  const t = await getTranslations("mypage.menu")
  const { countryCode } = await params
  const { page } = await searchParams
  const currentPage = Math.max(1, parseInt(page || "1", 10))

  const data = await fetchFrequentProducts(
    countryCode,
    currentPage,
    ITEMS_PER_PAGE
  )

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("rebuy"),
      }}
    >
      <MypageLayout>
        <FrequentProductsTemplate countryCode={countryCode} data={data} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
