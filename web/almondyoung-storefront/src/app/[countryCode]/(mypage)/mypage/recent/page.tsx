"use client"
import { ProductRowCard } from "@components/product-row-card/product-row-card"
import { PageTitle } from "@components/common/page-title"
import MypageLayout from "@components/layout/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
/**
 * 고정 찜 목록 데이터 (서버 데이터 구조)
 */

// 최근 본 상품 API 유저서비스 api호출
// id값을 기반으로 pim api 호출
const MOCK_WISHLIST_ITEMS = [
  {
    id: "wish-1",
    userId: "user-1",
    productId: "01999bd7-d4f0-7046-a89e-028a2823bcc4",
    createdAt: "2025-01-15T10:00:00Z",
    product: {
      id: "01999bd7-d4f0-7046-a89e-028a2823bcc4",
      name: "래쉬몬스터 오가닉 색소 - 블랙",
      thumbnail:
        "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
      thumbnails: [
        "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
      ],
      brand: "래쉬몬스터",
      basePrice: 30000,
      membershipPrice: 9000,
      status: "active",
      stock: {
        available: 3,
      },
      options: [],
    },
  },
  {
    id: "wish-2",
    userId: "user-1",
    productId: "prod-002",
    createdAt: "2025-01-14T09:00:00Z",
    product: {
      id: "prod-002",
      name: "제이시스 티나스타일링 에센스",
      thumbnail:
        "https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg",
      thumbnails: [
        "https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg",
      ],
      brand: "제이시스",
      basePrice: 25000,
      membershipPrice: 20000,
      status: "active",
      stock: {
        available: 15,
      },
      options: [],
    },
  },
  {
    id: "wish-3",
    userId: "user-1",
    productId: "prod-003",
    createdAt: "2025-01-13T08:00:00Z",
    product: {
      id: "prod-003",
      name: "프리미엄 속눈썹 연장 글루",
      thumbnail:
        "https://almondyoung.com/web/product/medium/202412/c9c6c8f8c8c6c8c6c8c6c8c6c8c6c8c6.jpg",
      thumbnails: [
        "https://almondyoung.com/web/product/medium/202412/c9c6c8f8c8c6c8c6c8c6c8c6c8c6c8c6.jpg",
      ],
      brand: "아몬드영",
      basePrice: 45000,
      membershipPrice: 36000,
      status: "active",
      stock: {
        available: 8,
      },
      options: [],
    },
  },
  {
    id: "wish-4",
    userId: "user-1",
    productId: "prod-004",
    createdAt: "2025-01-12T07:00:00Z",
    product: {
      id: "prod-004",
      name: "속눈썹 리무버 젤타입",
      thumbnail:
        "https://almondyoung.com/web/product/medium/202411/b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8.jpg",
      thumbnails: [
        "https://almondyoung.com/web/product/medium/202411/b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8.jpg",
      ],
      brand: "래쉬몬스터",
      basePrice: 18000,
      membershipPrice: 18000,
      status: "active",
      stock: {
        available: 25,
      },
      options: [],
    },
  },
  {
    id: "wish-5",
    userId: "user-1",
    productId: "prod-005",
    createdAt: "2025-01-11T06:00:00Z",
    product: {
      id: "prod-005",
      name: "볼륨 래쉬 C컬 0.07mm",
      thumbnail:
        "https://almondyoung.com/web/product/medium/202410/a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7.jpg",
      thumbnails: [
        "https://almondyoung.com/web/product/medium/202410/a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7.jpg",
      ],
      brand: "프리미엄래쉬",
      basePrice: 35000,
      membershipPrice: 28000,
      status: "inactive", // 품절 상품
      stock: {
        available: 0,
      },
      options: [],
    },
  },
]

export default function RecentPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "최근 본 상품",
      }}
    >
      <MypageLayout>
        <div className="bg-background w-full">
          <div className="bg-white md:px-6">
            <PageTitle>최근 본 상품</PageTitle>

            {/* 상품 목록 (고정 데이터) */}
            {MOCK_WISHLIST_ITEMS.map((item) => (
              <ProductRowCard
                key={item.id}
                item={item}
                onRemove={(id) => {
                  console.log("최근 본 상품 삭제:", id)
                }}
                onAddToCart={(item) => {
                  console.log("장바구니에 추가:", item)
                }}
                isLoading={false}
              />
            ))}
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
