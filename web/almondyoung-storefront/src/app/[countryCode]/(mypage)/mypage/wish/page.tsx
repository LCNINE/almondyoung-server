import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { WishlistTemplate } from "@/domains/wishlist/templates"
import { fetchWishlistItems } from "@/domains/wishlist/actions"

interface WishPageProps {
  params: Promise<{
    countryCode: string
  }>
  searchParams: Promise<{
    q?: string
    page?: string
  }>
}

export default async function WishPage({ params, searchParams }: WishPageProps) {
  const { countryCode } = await params
  const { q, page } = await searchParams

  const items = await fetchWishlistItems(countryCode, q || undefined)
  const currentPage = Number(page) || 1

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
        <WishlistTemplate
          countryCode={countryCode}
          items={items}
          initialQuery={q || ""}
          currentPage={currentPage}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
