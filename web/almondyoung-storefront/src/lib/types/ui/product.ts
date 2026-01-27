import { StoreProduct } from "@medusajs/types"
import { ProductsResponseDto } from "../dto/medusa"
import { ReviewResponseDto } from "../dto/ugc"

/*───────────────────────────
 * 상품 타입
 *──────────────────────────*/
export interface ProductList extends Pick<ProductsResponseDto, "products"> {}

export interface ProductWithReviews extends StoreProduct {
  reviews: ReviewResponseDto[] | undefined
}

export interface PriceInfo {
  original: number // 정가
  member?: number // 멤버십가 (없을 수 있음)
  discountRate?: number // (original - member)/original * 100 (정수)
  isMembership: boolean | null // true=멤버십 전용, false=일반상품, null=비회원상태(가격 숨김)
}

export interface PriceRange {
  min: number
  max: number
}

export interface StockInfo {
  available?: number // 총 가용 재고 (WMS 미연동 시 undefined)
  updatedAt?: string
  lowRemaining?: number // 임계량 이하 잔여 재고 표시용
}

export interface UserPurchaseStats {
  totalOrders: number // 주문 건수
  totalUnits: number // 누적 수량
  lastPurchasedAt?: string // ISO-8601
}

export interface UserPurchaseRecord {
  orderId: string
  variantId?: string
  quantity: number
  pricePaid: number
  purchasedAt: string
}

export interface UserProductMeta {
  isWishlisted?: boolean
  inCartQty?: number
  lastViewedAt?: string
  purchase?: UserPurchaseStats
  purchaseHistory?: UserPurchaseRecord[] // 상세 페이지에서만 보통 사용
}

export interface RecentViewProductThumbnail {
  productId: string
  viewedAt: string
  thumbnail: string
}

/**
 * ProductCardProps - 상품 카드 타입
 */
export interface ProductCardProps {
  id: string
  rank?: number
  title: string
  price: number
  originalPrice: number
  discount: number
  rating: number
  reviewCount: number
  imageSrc: string
  membershipSavings?: number
  showMembershipHint?: boolean
}

/**
 * ProductCard - 상품 목록/카드 타입
 *
 * 책임 분리 원칙:
 * 📡 서버: 비즈니스 로직 (가격 계산, 재고 판단, 권한 체크)
 * 💻 프론트: UI 로직 (할인율 계산, 포맷팅, 조건부 렌더링)
 */
export interface ProductCard {
  // ===== 필수 기본 정보 =====
  id: string
  name: string
  thumbnail: string // 서버에서 완전한 URL 제공
  createdAt?: string

  // ===== 가격 정보 (서버 제공) =====
  // 📡 서버: 비즈니스 로직으로 가격 계산/제공
  // 💻 프론트: 할인율 계산 (단순 수식), 포맷팅
  basePrice?: number // 정가
  membershipPrice?: number // 멤버십가
  actualPrice?: number // 현재 유저 기준 계산가
  isMembershipOnly?: boolean // 멤버십 전용 여부

  // ===== 재고/판매 상태 (서버 제공) =====
  // 📡 서버: 실시간 재고, 판매 상태 제공
  // 💻 프론트: 조건부 렌더링 (품절 태그, 재고 알림 등)
  status?: string // "active" | "inactive" | "soldout" 등
  stock?: StockInfo // 재고 정보

  // ===== 상품 메타 =====
  brand?: string
  tags?: string[]
  optionMeta?: {
    isSingle?: boolean // 단일 옵션 여부 (장바구니 아이콘 판단용)
  }
  defaultSku?: number
  purchaseCount?: number
  rating?: number
  reviewCount?: number
  userMeta?: UserProductMeta

  // ===== 타임세일 =====
  // 📡 서버: 타임세일 여부, 종료 시간 제공
  // 💻 프론트: 타이머 UI, 가격 색상 변경
  isTimeSale?: boolean
  timeSaleEndTime?: string // ISO 타임스탬프
}

// 옵션/변형 — UI 드롭다운/스와치에 맞춘 구조
export interface ProductOptionValue {
  id: string // 내부 식별자 (옵션값 ID)
  name: string // 사용자 라벨 (예: 카멜 브라운)
  code?: string // 외부 연동 코드 (예: P0000GZK000A)
  image?: string | null
  sku?: string // ✅ 실제 SKU (variantId)
  priceDiff?: number // 선택 시 추가되는 금액 (+2,000원 등)
  stock?: number // ✅ 해당 옵션 조합의 재고
  disabled?: boolean // ✅ 품절 여부를 직접 표시할 수도 있음
}

export interface ProductOption {
  type: string // 예: "색상"
  label: string // UI 라벨
  uiType?: "select" | "radio" | "color" | "size" | string
  values: ProductOptionValue[]
}

// 상세 전용
export interface MemberTierPrice {
  range: string // "1~∞" 등
  rate: number // % (정수)
  price: number // 단가
}

export interface ProductDetail extends ProductCard {
  thumbnails: string[] // 메인 + 추가 이미지
  description?: string
  descriptionHtml?: string
  detailImages?: string[] // HTML을 쪼개서 이미지 배열로 쓰고 싶을 때

  memberPrices?: MemberTierPrice[]
  originalPrice?: number // 호환성(카드 original mirror)
  options: ProductOption[] // 옵션 그룹

  actualPrice?: number
  defaultVariantId?: string
  variantPriceMap?: Record<
    string,
    { basePrice?: number; membershipPrice?: number }
  >
  variantThumbnailMap?: Record<string, string>

  // SKU → 수량 (WMS 연동 시 서비스에서 주입)
  skuStock?: Record<string, number>
  skuIndex?: Record<string, string> // "색상=블랙|용량=500ml" → variantId
  pimMasterId?: string

  // 옵션 선택 → SKU 매핑 함수 (서비스에서 주입)
  getSkuForSelection?: (
    selection: Record<string, string>
  ) => string | number | undefined

  shipping?: {
    type?: "domestic" | "international"
    method?: string
    cost?: string
    averageRestockDays?: number
    shipmentInfo?: string
  }

  productInfo?: Record<string, string> // 전성분/용량/제조사 등 자유 확장
  categories?: string[]

  // 리뷰/Q&A 집계(서버 준비되면 Service에서 주입)
  rating?: number
  reviewCount?: number
  qnaCount?: number

  seo?: {
    title?: string
    description?: string
    keywords?: string[]
    slug?: string
  }
}

// ==========================================
// 서비스 레이어 타입
// ==========================================

// 상품 목록 조회 파라미터
export interface ProductListParams {
  page?: number
  limit?: number
  sort?: string
  query?: string
  categoryId?: string
  brand?: string
  tags?: string[]
  stock?: string[] // ex) ["in_stock", "low_stock"]
}

// 상품목록 서비스 옵션
export interface ProductListServiceOpts {
  userId?: string
  withStock?: boolean
  withReview?: boolean
}

// 상품 목록 서비스 응답
export interface ProductListServiceResponse {
  items: ProductCard[]
  total: number
  page: number
  limit: number
}

/**
 * 상품 상세 서비스 옵션
 */
export interface ProductDetailServiceOpts {
  userId?: string
  withStock?: boolean
  // withReview?: boolean  // 추후 리뷰 요약 단건이 필요하면 추가
}

// 상품 검색 파라미터
export interface SearchProductParams {
  keyword?: string
  categoryId?: string
  brands?: string[]
  minPrice?: number
  maxPrice?: number
  status?: string
  tagFilters?: Array<{
    groupId: string
    valueIds: string[]
  }>
  sortBy?: "relevance" | "price" | "createdAt"
  sortOrder?: "asc" | "desc"
  page?: number
  limit?: number
}

// 상품 검색 결과
export interface SearchProductResult {
  items: ProductCard[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  aggregations?: {
    tags?: Array<{
      group_id: string
      group_name: string
      values: Array<{
        value_id: string
        value_name: string
        count: number
      }>
    }>
  }
}
