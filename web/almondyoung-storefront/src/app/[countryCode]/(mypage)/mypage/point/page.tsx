import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@/components/layout"
import { PointTemplate } from "@/domains/mypage/template/point"

interface PointPageProps {
  searchParams: Promise<{ page?: string }>
}

export default async function PointPage({ searchParams }: PointPageProps) {
  const { page } = await searchParams
  const currentPage = Math.max(1, Number(page) || 1)

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
        <PointTemplate page={currentPage} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
