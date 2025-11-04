import { PimProductDetail } from '../../../lib/types/dto/pim'

// 관심 카테고리 타입
export type InterestCategory = 
  | 'skincare' // 스킨케어
  | 'makeup' // 메이크업
  | 'haircare' // 헤어케어
  | 'bodycare' // 바디케어
  | 'lashcare' // 속눈썹케어
  | 'nailcare' // 네일케어
  | 'fragrance' // 향수
  | 'men' // 남성용품

// 피부 타입
export type SkinType = 
  | 'dry' // 건성
  | 'oily' // 지성
  | 'combination' // 복합성
  | 'sensitive' // 민감성
  | 'normal' // 중성

// 피부 고민
export type SkinConcern = 
  | 'acne' // 여드름
  | 'wrinkles' // 주름
  | 'dark_circles' // 다크서클
  | 'pores' // 모공
  | 'pigmentation' // 색소침착
  | 'dullness' // 칙칙함
  | 'sensitivity' // 민감성
  | 'oiliness' // 유분

// 브랜드 선호도
export interface BrandPreference {
  brandId: string
  brandName: string
  preferenceScore: number // 1-10 점수
  reason?: string
}

// 가격대 선호도
export interface PricePreference {
  minPrice: number
  maxPrice: number
  preferredRange: 'budget' | 'mid' | 'premium' | 'luxury'
}

// 사용자 맞춤 정보 인터페이스
export interface UserPreferences {
  id: string
  userId: string
  // 기본 정보
  skinType: SkinType
  skinConcerns: SkinConcern[]
  interestCategories: InterestCategory[]
  
  // 브랜드 선호도
  brandPreferences: BrandPreference[]
  
  // 가격대 선호도
  pricePreference: PricePreference
  
  // 구매 패턴
  purchasePattern: {
    averageOrderValue: number
    frequency: 'low' | 'medium' | 'high' // 구매 빈도
    preferredTime: 'morning' | 'afternoon' | 'evening' | 'night'
    preferredDay: 'weekday' | 'weekend' | 'any'
  }
  
  // 알레르기 정보
  allergies: string[]
  
  // 선호하는 제품 특성
  productPreferences: {
    organic: boolean
    crueltyFree: boolean
    vegan: boolean
    fragranceFree: boolean
    hypoallergenic: boolean
  }
  
  // 추천 설정
  recommendationSettings: {
    enabled: boolean
    frequency: 'daily' | 'weekly' | 'monthly'
    categories: InterestCategory[]
    maxPrice: number
    excludeOutOfStock: boolean
  }
  
  // 업데이트 정보
  lastUpdated: string
  lastSurveyDate?: string
}

// 맞춤 추천 제품 인터페이스
export interface RecommendedProduct {
  id: string
  productId: string
  product: PimProductDetail
  reason: string
  confidence: number // 0-100 신뢰도
  category: InterestCategory
  createdAt: string
}

// 사용자 맞춤 정보 mock 데이터
export const mockUserPreferences: UserPreferences = {
  id: 'pref_001',
  userId: 'user_001',
  skinType: 'combination',
  skinConcerns: ['pores', 'dullness', 'oiliness'],
  interestCategories: ['skincare', 'makeup', 'lashcare'],
  
  brandPreferences: [
    {
      brandId: '01999b22',
      brandName: '노몬드',
      preferenceScore: 9,
      reason: '속눈썹 제품이 효과적이었음'
    },
    {
      brandId: '01999bef',
      brandName: '웰컴딜',
      preferenceScore: 8,
      reason: '가성비 좋은 웰컴 상품'
    },
    {
      brandId: '01999bf0',
      brandName: '네일아트',
      preferenceScore: 7,
      reason: '네일아트 도구 품질이 좋음'
    },
    {
      brandId: '01999b23',
      brandName: 'Drawy make',
      preferenceScore: 6,
      reason: '새로운 브랜드 시도 중'
    }
  ],
  
  pricePreference: {
    minPrice: 10000,
    maxPrice: 100000,
    preferredRange: 'mid'
  },
  
  purchasePattern: {
    averageOrderValue: 45000,
    frequency: 'medium',
    preferredTime: 'evening',
    preferredDay: 'weekend'
  },
  
  allergies: ['니켈', '향료'],
  
  productPreferences: {
    organic: true,
    crueltyFree: true,
    vegan: false,
    fragranceFree: false,
    hypoallergenic: true
  },
  
  recommendationSettings: {
    enabled: true,
    frequency: 'weekly',
    categories: ['skincare', 'makeup', 'lashcare'],
    maxPrice: 80000,
    excludeOutOfStock: true
  },
  
  lastUpdated: '2024-01-15T10:30:00Z',
  lastSurveyDate: '2024-01-01T00:00:00Z'
}

// 맞춤 추천 제품 mock 데이터
export const mockRecommendedProducts: RecommendedProduct[] = [
  {
    id: 'rec_001',
    productId: '01999bef-e3a4-71ab-bc76-8c549e0d8338',
    product: {
      id: '01999bef-e3a4-71ab-bc76-8c549e0d8338',
      name: '속눈썹 연장 도구 세트',
      thumbnail: 'https://almondyoung.com/web/product/medium/202411/lash-extension-tools.png',
      basePrice: 35000,
      membershipPrice: 30000,
      brand: '노몬드',
      status: 'active',
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-12-15T00:00:00Z',
      isMembershipOnly: false,
      isWholesaleOnly: false,
      wholesalePrice: 28000,
      description: '속눈썹 연장에 필요한 모든 도구가 포함된 세트',
      descriptionHtml: '<p>속눈썹 연장에 필요한 모든 도구가 포함된 세트</p>'
    },
    reason: '전문 분야인 속눈썹 연장 도구로 관심 카테고리에 부합',
    confidence: 95,
    category: 'lashcare',
    createdAt: '2024-01-15T10:30:00Z'
  },
  {
    id: 'rec_002',
    productId: '01999bef-dcaf-739d-ad1f-b61a54ef59b0',
    product: {
      id: '01999bef-dcaf-739d-ad1f-b61a54ef59b0',
      name: '네일아트 젤 폴리시',
      thumbnail: 'https://almondyoung.com/web/product/medium/202411/nail-gel-polish.png',
      basePrice: 12000,
      membershipPrice: 10000,
      brand: '네일아트',
      status: 'active',
      createdAt: '2024-02-10T00:00:00Z',
      updatedAt: '2024-12-10T00:00:00Z',
      isMembershipOnly: false,
      isWholesaleOnly: false,
      wholesalePrice: 9000,
      description: '고품질 네일아트 젤 폴리시',
      descriptionHtml: '<p>고품질 네일아트 젤 폴리시</p>'
    },
    reason: '관심 카테고리인 네일아트 제품으로 전문 분야에 부합',
    confidence: 88,
    category: 'nailcare',
    createdAt: '2024-01-15T10:30:00Z'
  },
  {
    id: 'rec_003',
    productId: '01999bef-d5c0-743f-b9eb-cff7e6da05cd',
    product: {
      id: '01999bef-d5c0-743f-b9eb-cff7e6da05cd',
      name: '속눈썹 영양제 프리미엄',
      thumbnail: 'https://almondyoung.com/web/product/medium/202411/lash-nutrition-premium.png',
      basePrice: 25000,
      membershipPrice: 20000,
      brand: '노몬드',
      status: 'active',
      createdAt: '2024-03-05T00:00:00Z',
      updatedAt: '2024-12-05T00:00:00Z',
      isMembershipOnly: true,
      isWholesaleOnly: false,
      wholesalePrice: 18000,
      description: '프리미엄 속눈썹 영양제',
      descriptionHtml: '<p>프리미엄 속눈썹 영양제</p>'
    },
    reason: '멤버십 전용 프리미엄 제품으로 전문 분야에 부합',
    confidence: 92,
    category: 'lashcare',
    createdAt: '2024-01-15T10:30:00Z'
  }
]

// 맞춤정보 관련 함수들
export const getUserPreferences = (): UserPreferences => mockUserPreferences

export const getUserPreferencesByUserId = (userId: string): UserPreferences | null => {
  return mockUserPreferences.userId === userId ? mockUserPreferences : null
}

export const updateUserPreferences = (updates: Partial<UserPreferences>): UserPreferences => {
  return { ...mockUserPreferences, ...updates, lastUpdated: new Date().toISOString() }
}

export const getRecommendedProducts = (): RecommendedProduct[] => mockRecommendedProducts

export const getRecommendedProductsByUserId = (userId: string): RecommendedProduct[] => {
  return mockRecommendedProducts
}

export const getRecommendedProductsByCategory = (category: InterestCategory): RecommendedProduct[] => {
  return mockRecommendedProducts.filter(product => product.category === category)
}

export const getRecommendedProductsByConfidence = (minConfidence: number): RecommendedProduct[] => {
  return mockRecommendedProducts.filter(product => product.confidence >= minConfidence)
}

export const addBrandPreference = (brandId: string, brandName: string, score: number, reason?: string): BrandPreference => {
  const newPreference: BrandPreference = {
    brandId,
    brandName,
    preferenceScore: score,
    reason
  }
  
  mockUserPreferences.brandPreferences.push(newPreference)
  return newPreference
}

export const updateBrandPreference = (brandId: string, score: number, reason?: string): BrandPreference | null => {
  const preference = mockUserPreferences.brandPreferences.find(pref => pref.brandId === brandId)
  if (preference) {
    preference.preferenceScore = score
    if (reason) preference.reason = reason
    return preference
  }
  return null
}

export const removeBrandPreference = (brandId: string): boolean => {
  const index = mockUserPreferences.brandPreferences.findIndex(pref => pref.brandId === brandId)
  if (index > -1) {
    mockUserPreferences.brandPreferences.splice(index, 1)
    return true
  }
  return false
}

export const updateSkinType = (skinType: SkinType): void => {
  mockUserPreferences.skinType = skinType
  mockUserPreferences.lastUpdated = new Date().toISOString()
}

export const updateSkinConcerns = (concerns: SkinConcern[]): void => {
  mockUserPreferences.skinConcerns = concerns
  mockUserPreferences.lastUpdated = new Date().toISOString()
}

export const updateInterestCategories = (categories: InterestCategory[]): void => {
  mockUserPreferences.interestCategories = categories
  mockUserPreferences.lastUpdated = new Date().toISOString()
}

export const updatePricePreference = (minPrice: number, maxPrice: number, range: 'budget' | 'mid' | 'premium' | 'luxury'): void => {
  mockUserPreferences.pricePreference = {
    minPrice,
    maxPrice,
    preferredRange: range
  }
  mockUserPreferences.lastUpdated = new Date().toISOString()
}
