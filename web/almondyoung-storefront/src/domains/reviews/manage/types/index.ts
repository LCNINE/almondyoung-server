/**
 * 리뷰 도메인 관련 타입 정의
 */

export interface ProductInfo {
  imageUrl: string
  storeName: string
  title: string
  options: string
  /** '작성 가능한 리뷰' 카드에서만 사용되는 선택적 프로퍼티 */
  purchaseDate?: string
}

export interface BenefitInfo {
  /** 예: 1000 */
  points: number
  /** 예: "2025.10.30." */
  deadline: string
  /** 예: 8 */
  dDay: number
}

export interface ReviewInfo {
  rating: number
  text: string
}

export interface WritableReview {
  id: string
  product: ProductInfo
  benefit: BenefitInfo
}

export interface WrittenReview {
  id: string
  productInfo: ProductInfo
  reviewData: ReviewInfo
}
