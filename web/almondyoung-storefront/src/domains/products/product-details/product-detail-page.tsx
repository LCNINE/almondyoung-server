"use client"

import { Breadcrumb } from "@components/layout/components/breadcrumb"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { useRecentViews } from "@hooks/api/use-recent-views"
import { toggleWishlist } from "@lib/api/users/wishlist"
import type { ProductDetail } from "@lib/types/ui/product"
import { ProductCard } from "@lib/types/ui/product"
import type { UserDetail, WishlistItem } from "@lib/types/ui/user"
import { ProductRecommandSlider } from "components/product-recommand-slider"
import { ReviewDetailCardList } from "domains/reviews/details"
import {
  ProductReviewThumbnailGallery,
  ReviewSummary,
} from "domains/reviews/summary"
import { use, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { ProductDetailInfo } from "./components/product-detail-info"
import { ProductImageGallery } from "./components/product-image-gallery"
import { ProductInfoAccordion } from "./components/product-info-accordion"
import { ProductInfoMobile } from "./components/product-info-mobile"
import { ProductQnaSection } from "./components/product-qna-section"
import { ProductSidebarPurchase } from "./components/product-sidebar-purchase"
import { ProductTabs } from "./components/product-tabs"
import { useRouter } from "next/navigation"

interface ProductDetailPageProps {
  params: Promise<{
    id: string
    countryCode: string
  }>
  product: ProductDetail | null
  error?: string | null
  user: UserDetail | null
  wishlist: WishlistItem | null
}

// Mock 데이터
const reviewListData = {
  reviews: [
    {
      id: "r1",
      author: "이*희",
      rating: 5,
      date: "2025-05-09T00:00:00Z",
      tags: ["10년차 원장님", "재구매"],
      text: "얇고 촥 붙어요 좋습니다!\n언제나 믿고 사는 제품이에요. 가격이나 품질이나 모두 괜찮습니다",
      productOption: "옵션: 100매 x 2박스",
      thumbnails: [
        { src: "/images/review-1.jpg", alt: "리뷰 사진 1" },
        { src: "/images/review-2.jpg", alt: "리뷰 사진 2" },
      ],
      likeCount: 24,
    },
    {
      id: "r2",
      author: "강*희",
      rating: 4,
      date: "2025-05-09T00:00:00Z",
      tags: ["10년차 원장님"],
      text: "촉촉하고 유통기한 넉넉해서 좋네요!",
      productOption: "옵션: 50매 x 1박스",
      thumbnails: [{ src: "/images/review-3.jpg", alt: "리뷰 사진 3" }],
      likeCount: 15,
    },
    {
      id: "r3",
      author: "박*수",
      rating: 5,
      date: "2025-05-08T00:00:00Z",
      tags: ["5년차 원장님", "재구매"],
      text: "가성비 최고입니다. 항상 구매하는 제품이에요.",
      likeCount: 32,
    },
    {
      id: "r4",
      author: "최*영",
      rating: 5,
      date: "2025-05-07T00:00:00Z",
      tags: ["3년차 원장님"],
      text: "품질 좋고 배송도 빨라요!",
      productOption: "옵션: 100매 x 1박스",
      likeCount: 18,
    },
    {
      id: "r5",
      author: "김*민",
      rating: 4,
      date: "2025-05-06T00:00:00Z",
      tags: ["7년차 원장님", "재구매"],
      text: "만족스럽습니다. 다음에도 구매할게요.",
      thumbnails: [
        { src: "/images/review-4.jpg", alt: "리뷰 사진 4" },
        { src: "/images/review-5.jpg", alt: "리뷰 사진 5" },
        { src: "/images/review-6.jpg", alt: "리뷰 사진 6" },
      ],
      likeCount: 27,
    },
    {
      id: "r6",
      author: "정*아",
      rating: 5,
      date: "2025-05-05T00:00:00Z",
      tags: ["8년차 원장님"],
      text: "항상 이 제품만 사용합니다. 믿을 수 있어요.",
      productOption: "옵션: 100매 x 3박스",
      likeCount: 41,
    },
    {
      id: "r7",
      author: "윤*진",
      rating: 4,
      date: "2025-05-04T00:00:00Z",
      tags: ["2년차 원장님"],
      text: "처음 써봤는데 괜찮네요. 다음에도 구매할 것 같아요.",
      thumbnails: [{ src: "/images/review-7.jpg", alt: "리뷰 사진 7" }],
      likeCount: 12,
    },
    {
      id: "r8",
      author: "한*우",
      rating: 5,
      date: "2025-05-03T00:00:00Z",
      tags: ["6년차 원장님", "재구매"],
      text: "품질 대비 가격이 정말 좋습니다. 추천해요!",
      likeCount: 29,
    },
    {
      id: "r9",
      author: "송*미",
      rating: 5,
      date: "2025-05-02T00:00:00Z",
      tags: ["4년차 원장님"],
      text: "배송도 빠르고 제품도 만족스럽습니다.",
      productOption: "옵션: 50매 x 2박스",
      thumbnails: [
        { src: "/images/review-8.jpg", alt: "리뷰 사진 8" },
        { src: "/images/review-9.jpg", alt: "리뷰 사진 9" },
      ],
      likeCount: 22,
    },
    {
      id: "r10",
      author: "조*현",
      rating: 4,
      date: "2025-05-01T00:00:00Z",
      tags: ["9년차 원장님", "재구매"],
      text: "오랫동안 사용하고 있는 제품입니다. 안정적이에요.",
      likeCount: 35,
    },
    {
      id: "r11",
      author: "임*서",
      rating: 5,
      date: "2025-04-30T00:00:00Z",
      tags: ["1년차 원장님"],
      text: "신규 원장인데 선배 추천으로 구매했어요. 만족합니다!",
      productOption: "옵션: 100매 x 1박스",
      likeCount: 19,
    },
    {
      id: "r12",
      author: "장*은",
      rating: 5,
      date: "2025-04-29T00:00:00Z",
      tags: ["12년차 원장님", "재구매"],
      text: "오래 사용한 제품이라 믿고 삽니다. 항상 감사합니다.",
      thumbnails: [{ src: "/images/review-10.jpg", alt: "리뷰 사진 10" }],
      likeCount: 48,
    },
  ],
}

/**
 * @description 상품 상세 페이지 (리팩토링 버전)
 * - 시맨틱 HTML 적극 활용
 * - 과도한 div 제거
 * - CSS 중첩 최소화
 * - 컴포넌트 분리
 */
const ProductDetailPage: React.FC<ProductDetailPageProps> = ({
  params,
  product,
  error,
  user,
  wishlist,
}) => {
  const resolvedParams = use(params)
  const { countryCode } = resolvedParams
  const router = useRouter()
  // ===== 상태 관리 =====
  const [activeTab, setActiveTab] = useState<
    "detail" | "review" | "qna" | "info"
  >("detail")
  const [mainImage, setMainImage] = useState(
    product?.thumbnails?.[0] || product?.thumbnail || ""
  )
  const [isWishlisted, setIsWishlisted] = useState(() => {
    return wishlist ? true : false
  })

  const [isPending, startTransition] = useTransition()

  // ===== Refs =====
  const detailRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const qnaRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)

  // ===== Hooks =====
  const { addToCart } = useAddToCart()

  useRecentViews(null, {
    userId: user?.id,
    useCache: true,
    autoAdd: {
      productId: product?.id || "",
      delay: 2000,
      addOnce: true,
    },
  })

  // ===== 에러 처리 =====
  if (error || !product) {
    return (
      <main className="md:bg-muted/50 flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-600">
            {error || "상품을 불러올 수 없습니다."}
          </p>
        </div>
      </main>
    )
  }

  // ===== 핸들러 =====
  const scrollToSection = (tab: typeof activeTab) => {
    const refs = {
      detail: detailRef,
      review: reviewRef,
      qna: qnaRef,
      info: infoRef,
    }
    refs[tab]?.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleWishlistToggle = (productId: string) => {
    if (!user) {
      toast.error(
        "로그인이 필요한 기능입니다. 먼저 로그인 후 다시 시도해 주세요."
      )
      return
    }

    const previousState: boolean = isWishlisted

    setIsWishlisted(!isWishlisted)

    startTransition(async () => {
      try {
        // 성공
        await toggleWishlist(productId)
        toast.success(
          isWishlisted
            ? "찜 목록에서 상품이 삭제되었습니다."
            : "상품이 찜 목록에 추가되었습니다."
        )

        router.refresh()
      } catch (error) {
        // 실패시 상태 복원
        setIsWishlisted(previousState)

        console.error("찜하기 실패", error)
        toast.error("찜 처리 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }
    })
  }

  // TODO: 실제 추천 제품 API 연동 필요
  const recommendedProducts: ProductCard[] = []

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <Breadcrumb />

      <div className="mx-auto max-w-[1360px] px-[15px] md:px-[40px]">
        <div className="py-2 md:flex md:gap-4">
          {/* 메인 콘텐츠 */}
          <main className="w-full min-w-0 flex-1">
            {/* 이미지 갤러리 */}
            <ProductImageGallery
              thumbnails={product.thumbnails || []}
              mainImage={mainImage}
              productName={product.name}
              onImageChange={setMainImage}
            />

            {/* 모바일 상품 정보 */}
            <ProductInfoMobile product={product} />

            {/* 추천 상품 */}
            <ProductRecommandSlider
              title="다른 원장님들이 함께 본 상품 BEST"
              products={recommendedProducts}
              onCartClick={(p) => addToCart({ variantId: p.id, quantity: 1 })}
              className="py-4 md:py-8"
              itemsPerView={{ mobile: 1.2, tablet: 2.5, desktop: 4 }}
            />

            {/* 탭 네비게이션 */}
            <ProductTabs
              activeTab={activeTab}
              reviewCount={product.reviewCount || 0}
              qnaCount={product.qnaCount || 0}
              onTabChange={(tab) => {
                setActiveTab(tab)
                scrollToSection(tab)
              }}
            />

            {/* 상세정보 */}
            <div ref={detailRef} id="detail-panel" role="tabpanel">
              <ProductDetailInfo
                productInfo={product.productInfo || {}}
                detailImages={product.detailImages || []}
                productName={product.name}
              />
            </div>

            {/* 리뷰 */}
            <div
              ref={reviewRef}
              id="review-panel"
              role="tabpanel"
              className="mb-8 rounded-lg bg-white px-0 py-6 md:px-6"
            >
              <ReviewSummary
                totalReviews={4617}
                averageRating={product.rating || 4.7}
                summaryTags={[
                  "촉촉해요",
                  "얇아요",
                  "잘 마르지 않아요",
                  "마음에 들어요",
                  "항상 사용해요",
                  "자극적이지 않아요",
                  "가성비가 좋아요",
                  "건조하지 않아요",
                  "재구매 했어요",
                ]}
              />

              <div className="my-6 px-4">
                <ProductReviewThumbnailGallery
                  thumbnails={[
                    {
                      id: "t1",
                      src: "/images/review-1.jpg",
                      alt: "리뷰 사진 1",
                    },
                    {
                      id: "t2",
                      src: "/images/review-2.jpg",
                      alt: "리뷰 사진 2",
                    },
                    {
                      id: "t3",
                      src: "/images/review-3.jpg",
                      alt: "리뷰 사진 3",
                    },
                    {
                      id: "t4",
                      src: "/images/review-4.jpg",
                      alt: "리뷰 사진 4",
                    },
                    {
                      id: "t5",
                      src: "/images/review-5.jpg",
                      alt: "리뷰 사진 5",
                    },
                    {
                      id: "t6",
                      src: "/images/review-6.jpg",
                      alt: "리뷰 사진 6",
                    },
                    {
                      id: "t7",
                      src: "/images/review-7.jpg",
                      alt: "리뷰 사진 7",
                    },
                    {
                      id: "t8",
                      src: "/images/review-8.jpg",
                      alt: "리뷰 사진 8",
                    },
                  ]}
                  moreCount={4100}
                  onMoreClick={() => console.log("더보기 클릭")}
                />
              </div>

              <ReviewDetailCardList
                reviews={reviewListData.reviews}
                itemsPerPage={5}
                onLike={(reviewId, liked) =>
                  console.log(`Review ${reviewId} liked: ${liked}`)
                }
              />
            </div>

            {/* Q&A */}
            <div ref={qnaRef} id="qna-panel" role="tabpanel">
              <ProductQnaSection />
            </div>

            {/* 구매/반품 정보 */}
            <div ref={infoRef} id="info-panel" role="tabpanel">
              <ProductInfoAccordion />
            </div>
          </main>

          {/* 사이드바 (데스크탑) */}
          <ProductSidebarPurchase
            product={product}
            isWishlisted={isWishlisted}
            isWishlistPending={isPending}
            onWishlistToggle={handleWishlistToggle}
            countryCode={countryCode}
          />
        </div>
      </div>

      {/* TODO: 모바일 하단 액션바 & 바텀시트 - 추후 개선 필요 */}
    </div>
  )
}

export default ProductDetailPage
