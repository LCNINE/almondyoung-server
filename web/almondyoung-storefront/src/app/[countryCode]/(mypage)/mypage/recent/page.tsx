import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"
import { fetchRecentViewItems } from "domains/recent-views/actions"
import { RecentViewsTemplate } from "domains/recent-views/templates"

interface RecentPageProps {
  params: Promise<{
    countryCode: string
  }>
  searchParams: Promise<{
    page?: string
  }>
}

export default async function RecentPage({
  params,
  searchParams,
}: RecentPageProps) {
  const t = await getTranslations("mypage.menu")
  const { countryCode } = await params
  const { page } = await searchParams
  const currentPage = Math.max(1, parseInt(page || "1", 10))

  const items = await fetchRecentViewItems(countryCode, 100)
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("recent"),
      }}
    >
      <MypageLayout>
        <RecentViewsTemplate
          countryCode={countryCode}
          items={items}
          currentPage={currentPage}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
