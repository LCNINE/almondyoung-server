"use client"

import { Breadcrumb } from "@components/layout/components/breadcrumb"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { useRecentViews } from "@hooks/api/use-recent-views"
import { toggleWishlist } from "@lib/api/users/wishlist"
import type { ProductDetail } from "@lib/types/ui/product"
import { ProductCard } from "@lib/types/ui/product"
import type { UserDetail, WishlistItem } from "@lib/types/ui/user"
import { ProductRecommandSlider } from "@components/products/product-recommand-slider"
import { ReviewSummary } from "domains/reviews/summary"
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
            {/* <ProductInfoMobile product={product} /> */}

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
                descriptionHtml={product.descriptionHtml}
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
                totalReviews={product.reviewCount || 0}
                averageRating={product.rating || 0}
                summaryTags={[]}
              />
              <div className="px-4 text-sm text-gray-500">
                리뷰 데이터가 준비되면 표시됩니다.
              </div>
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
