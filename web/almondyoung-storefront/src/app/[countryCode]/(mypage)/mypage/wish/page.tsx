import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
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
        mobileSubBackHeaderTitle: "찜 목록",
      }}
    >
      <MypageLayout>
        <div className="p-4 md:p-6">
          <h1 className="mb-6 text-xl font-bold md:text-2xl">찜 목록</h1>
          <WishlistContainer countryCode={countryCode} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
