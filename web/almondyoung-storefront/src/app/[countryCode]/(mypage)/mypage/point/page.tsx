import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@/components/layout"
import { PointTemplate } from "@/domains/mypage/template/point/point-template"
import { getTranslations } from "next-intl/server"

interface PointPageProps {
  searchParams: Promise<{
    page?: string
    year?: string
    month?: string
    from?: string
    to?: string
  }>
}

export default async function PointPage({ searchParams }: PointPageProps) {
  const t = await getTranslations("mypage.page")
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("pointEarn"),
      }}
    >
      <MypageLayout>
        <PointTemplate
          page={currentPage}
          year={params.year}
          month={params.month}
          from={params.from}
          to={params.to}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
