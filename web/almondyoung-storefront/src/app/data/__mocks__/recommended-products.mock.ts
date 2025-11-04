// 추천 상품용 타입 (서버 구조와 동일)
export interface RecommendedProduct {
  id: string
  name: string
  thumbnail: string
  basePrice?: number
  membershipPrice?: number
  isMembershipOnly?: boolean
  status?: string
  stock?: {
    available?: number
    updatedAt?: string
  }
  optionMeta?: {
    isSingle?: boolean
  }
  rating?: number
  reviewCount?: number
}

// 추천 상품 목업데이터 (서버 구조와 동일)
export const recommendedProducts: RecommendedProduct[] = [
  {
    id: "rec-1",
    name: "추천 상품 1 - 래쉬몬스터 오가닉 색소",
    thumbnail:
      "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
    basePrice: 30000,
    membershipPrice: 9000,
    isMembershipOnly: false,
    status: "active",
    stock: {
      available: 10,
      updatedAt: new Date().toISOString(),
    },
    optionMeta: {
      isSingle: true,
    },
    rating: 4.5,
    reviewCount: 123,
  },
  {
    id: "rec-2",
    name: "추천 상품 2 - 미라클 플랫모",
    thumbnail:
      "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
    basePrice: 15000,
    membershipPrice: 9000,
    isMembershipOnly: false,
    status: "active",
    stock: {
      available: 4,
      updatedAt: new Date().toISOString(),
    },
    optionMeta: {
      isSingle: true,
    },
    rating: 4.5,
    reviewCount: 89,
  },
  {
    id: "rec-3",
    name: "추천 상품 3 - BL Lashes 다이아몬드",
    thumbnail:
      "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
    basePrice: 25000,
    membershipPrice: 9000,
    isMembershipOnly: false,
    status: "active",
    stock: {
      available: 10,
      updatedAt: new Date().toISOString(),
    },
    optionMeta: {
      isSingle: false,
    },
    rating: 3,
    reviewCount: 25,
  },
  {
    id: "rec-4",
    name: "추천 상품 4 - 라부부 캐릭터 브러쉬",
    thumbnail:
      "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
    basePrice: 30000,
    membershipPrice: 9000,
    isMembershipOnly: false,
    status: "active",
    stock: {
      available: 4,
      updatedAt: new Date().toISOString(),
    },
    optionMeta: {
      isSingle: true,
    },
    rating: 4.5,
    reviewCount: 67,
  },
]

// 상세페이지용 추천 상품 데이터 (4개)
export const getRecommendedProducts = (): RecommendedProduct[] => {
  return recommendedProducts
}
