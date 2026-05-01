import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@/components/layout"
import { PointTemplate } from "@/domains/mypage/template/point/point-template"

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
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "포인트 적립",
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
