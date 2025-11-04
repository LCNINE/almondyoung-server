import type { WritableReview, WrittenReview } from "../types"
import { DEFAULT_REVIEW_POINTS } from "./constants"

/**
 * 리뷰 도메인 모킹 데이터
 */
export const writableReviewsData: WritableReview[] = [
  {
    id: "product-1",
    product: {
      imageUrl: "/images/sample-yogurt.png",
      storeName: "[스마트스토어] 또그린 그릭요거트",
      title: "[또그린] 꾸덕한 수제 무지방 그릭요거트 1kg 무가당 무첨가 대용량",
      options: "그릭요거트 선택: 꾸덕한 무지방 그릭요거트 1kg",
      purchaseDate: "25.10.01.",
    },
    benefit: {
      points: DEFAULT_REVIEW_POINTS,
      deadline: "2025.10.30.",
      dDay: 8,
    },
  },
  {
    id: "product-2",
    product: {
      imageUrl: "/images/sample-product.png",
      storeName: "[네이버페이] 플리",
      title: "[화해 1위] 그린 토마토 포어 리프팅 앰플 팩 클렌저 120ml",
      options: "상품 구성: [17% ▼] 클레이 팩 클렌저 1개",
      // purchaseDate가 없어도 타입 에러가 발생하지 않습니다.
    },
    benefit: {
      points: DEFAULT_REVIEW_POINTS,
      deadline: "2025.10.30.",
      dDay: 8,
    },
  },
]

export const writtenReviewsData: WrittenReview[] = [
  {
    id: "review-123",
    productInfo: {
      imageUrl: "/images/sample-product.png",
      storeName: "[네이버페이] 플리",
      title: "[화해 1위] 그린 토마토 포어 리프팅 앰플 팩 클렌저 120ml",
      options: "상품 구성: [17% ▼] 클레이 팩 클렌저 1개",
    },
    reviewData: {
      rating: 5,
      text: "클렌징인데 팩도 같이되니까 너무 좋아요!",
    },
  },
]
