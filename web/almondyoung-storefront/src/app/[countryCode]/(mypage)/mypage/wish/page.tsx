import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { WishlistContainer } from "./wishlist-container"

interface WishPageProps {
  params: Promise<{
    countryCode: string
  }>
}

export default async function WishPage({ params }: WishPageProps) {
  const { countryCode } = await params

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "찜한 상품",
      }}
    >
      <MypageLayout>
        <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
          <PageTitle>찜한 상품</PageTitle>
          <WishlistContainer countryCode={countryCode} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
