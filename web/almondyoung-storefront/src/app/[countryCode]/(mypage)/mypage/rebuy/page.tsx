import { Metadata } from "next"
import { PageTitle } from "@components/common/page-title"
import MypageLayout from "@components/layout/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { BasicProductCard } from "@components/products/product-card"

export const metadata: Metadata = {
  title: "재구매",
  description: "재구매 상품을 확인하세요",
}

const products = [
  {
    id: "1",
    name: "상품 1",
    thumbnail: "https://via.placeholder.com/150",
    basePrice: 10000,
    membershipPrice: 10000,
    isMembershipOnly: false,
    status: "active",
    stock: {
      available: 10,
    },
    optionMeta: {
      isSingle: false,
    },
    defaultSku: 1,
    purchaseCount: 10,
    rating: 4.5,
    reviewCount: 10,
  },
]

export default function RebuyPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      <MypageLayout>
        <div className="min-h-screen bg-white py-4 md:px-6">
          <PageTitle>자주 산 상품 목록</PageTitle>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {Array.from({ length: 10 }).map((_, index) => (
                <BasicProductCard key={index} product={products[0]} />
              ))}
            </div>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
