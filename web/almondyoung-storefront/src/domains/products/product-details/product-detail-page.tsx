"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CartSuccessModal } from "@/components/modals/cart-success-modal"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { useRecentViews } from "@hooks/api/use-recent-views"
import { toggleWishlist } from "@lib/api/users/wishlist"
import type { ProductDetail } from "@lib/types/ui/product"
import type { UserDetail, WishlistItem } from "@lib/types/ui/user"
import { ProductReviewSection } from "domains/reviews/product-review-section"
import { use, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { ProductDetailInfo } from "./components/product-detail-info"
import { ProductImageGallery } from "./components/product-image-gallery"
import { ProductInfoAccordion } from "./components/product-info-accordion"
import { ProductBottomBar } from "./components/product-bottom-bar"
import { ProductBottomSheet } from "./components/product-bottom-sheet"
import { ProductInfoMobile } from "./components/product-info-mobile"
import { ProductSidebarPurchase } from "./components/product-sidebar-purchase"
import { ProductTabs } from "./components/product-tabs"
import { useRouter } from "next/navigation"
import { createPortal } from "react-dom"
// import { Breadcrumb } from "@components/layout/components/breadcrumb"
// import { ProductCard } from "@lib/types/ui/product"
// import { ProductRecommandSlider } from "@components/products/product-recommand-slider"
// import { ProductQnaSection } from "./components/product-qna-section"

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
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({})
  const [selectedCartOptions, setSelectedCartOptions] = useState<
    Array<{
      id: string
      variantId?: string
      name: string
      quantity: number
      price: number
      image: string
      stock?: number
    }>
  >([])
  const [showSuccessMessage, setShowSuccessMessage] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const [showCartSuccessModal, setShowCartSuccessModal] = useState(false)
  const [reviewCount, setReviewCount] = useState(product?.reviewCount || 0)
  const [averageRating, setAverageRating] = useState(product?.rating || 0)

  const [isPending, startTransition] = useTransition()

  // ===== Refs =====
  const detailRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const qnaRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)

  // ===== Hooks =====
  const { addToCart, isLoading: isAddToCartLoading } = useAddToCart()

  useRecentViews(null, {
    userId: user?.id,
    useCache: true,
    autoAdd: {
      productId: product?.id || "",
      delay: 2000,
      addOnce: true,
    },
  })

  useEffect(() => {
    setIsMounted(true)
  }, [])

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

  const isSingleOption = !product.options || product.options.length === 0
  const isOutOfStock = product.status !== "active"
  const getVariantPrice = (variantId?: string) => {
    if (variantId && variantId === product.defaultVariantId) {
      return product.membershipPrice || product.basePrice || 0
    }
    if (variantId && product.variantPriceMap?.[variantId]) {
      const price = product.variantPriceMap[variantId]
      return price.membershipPrice || price.basePrice || 0
    }
    return product.membershipPrice || product.basePrice || 0
  }
  const defaultVariantId = product.defaultVariantId
  const getProductPrice = () => getVariantPrice(defaultVariantId)
  const getTotalPrice = () => {
    if (isSingleOption) return quantity * getProductPrice()
    return selectedCartOptions.reduce(
      (sum, opt) => sum + opt.price * opt.quantity,
      0
    )
  }

  const handleOptionChange = (optionLabel: string, value: string) => {
    const next = { ...selectedOptions, [optionLabel]: value }
    const allSelected = (product.options ?? []).every((o) => !!next[o.label])

    if (!allSelected) {
      setSelectedOptions(next)
      return
    }

    const optionName = (product.options ?? [])
      .map((o) => next[o.label])
      .join(" / ")
    const selectionKey = (product.options ?? [])
      .map((o) => `${o.label}=${next[o.label]}`)
      .join("|")
    const variantId = product.skuIndex?.[selectionKey]

    if (!variantId) {
      toast.error("선택한 옵션 조합의 정보를 찾을 수 없습니다.")
      setSelectedOptions(next)
      return
    }

    const optionPrice = getVariantPrice(variantId)

    setSelectedCartOptions((prevCart) => {
      const exists = prevCart.find((p) => p.name === optionName)
      if (exists) {
        return prevCart.map((p) =>
          p.name === optionName ? { ...p, quantity: p.quantity + 1 } : p
        )
      }
      return [
        ...prevCart,
        {
          id: `${product.id}-${Date.now()}`,
          variantId,
          name: optionName,
          quantity: 1,
          price: optionPrice,
          image:
            (variantId && product.variantThumbnailMap?.[variantId]) ||
            product.thumbnails?.[0] ||
            product.thumbnail ||
            "https://placehold.co/80x80?text=No+Image",
          stock: (variantId && product.skuStock?.[variantId]) || undefined,
        },
      ]
    })

    // 옵션 선택 초기화
    setSelectedOptions({})
  }

  const handleQuantityUpdate = (id: string, newQuantity: number) => {
    if (newQuantity < 1) {
      setSelectedCartOptions((prev) => prev.filter((opt) => opt.id !== id))
    } else {
      setSelectedCartOptions((prev) =>
        prev.map((opt) =>
          opt.id === id ? { ...opt, quantity: newQuantity } : opt
        )
      )
    }
  }

  const handleOptionRemove = (id: string) => {
    setSelectedCartOptions((prev) => prev.filter((opt) => opt.id !== id))
  }

  const openBottomSheet = () => {
    setShowSuccessMessage(false)
    setIsBottomSheetOpen(true)
  }

  const closeBottomSheet = () => {
    setShowSuccessMessage(false)
    setIsBottomSheetOpen(false)
  }

  const handleAddToCart = async (showModal = false) => {
    if (isSingleOption) {
      const variantId = product.defaultVariantId || product.id
      const result = await addToCart({ variantId, quantity })
      if (result?.success) {
        setShowSuccessMessage(true)
        if (showModal) {
          setShowCartSuccessModal(true)
        }
        return true
      }
      return false
    }

    if (selectedCartOptions.length === 0) {
      toast.error("옵션을 선택해 주세요.")
      return false
    }

    const results = await Promise.all(
      selectedCartOptions.map((option) =>
        option.variantId
          ? addToCart({
            variantId: option.variantId,
            quantity: option.quantity,
          })
          : Promise.resolve({ success: false })
      )
    )
    const hasSuccess = results.some((result) => result?.success)
    if (hasSuccess) {
      setShowSuccessMessage(true)
      if (showModal) {
        setShowCartSuccessModal(true)
      }
    }
    return hasSuccess
  }

  // 데스크탑 사이드바용 장바구니 담기 핸들러 (모달 표시)
  const handleDesktopAddToCart = async () => {
    return handleAddToCart(true)
  }

  const handleBuyNow = async () => {
    if (!user) {
      setShowLoginDialog(true)
      return
    }

    if (!isSingleOption && selectedCartOptions.length === 0) {
      toast.error("옵션을 선택해 주세요.")
      return
    }

    const didAdd = await handleAddToCart()

    if (didAdd) {
      setShowSuccessMessage(true)
      router.push(`/${countryCode}/checkout`)
    }
  }

  const handleLoginConfirm = () => {
    setShowLoginDialog(false)
    router.push(
      `/${countryCode}/login?redirect_to=${encodeURIComponent(window.location.pathname)}`
    )
  }

  const handleGoToCart = () => {
    router.push(`/${countryCode}/cart`)
  }

  // todo: 추천상품 임시 비활성화
  // const recommendedProducts: ProductCard[] = []

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      {/* todo: 상품 상세 상단 breadcrumb 임시 비활성화 */}
      {/* <Breadcrumb /> */}

      <div className="mx-auto max-w-[1360px] px-[15px] md:px-[40px]">
        <div className="py-2 md:flex md:gap-4">
          {/* 메인 콘텐츠 */}
          <main className="w-full min-w-0 flex-1 pb-24 md:pb-0">
            {/* 이미지 갤러리 */}
            <ProductImageGallery
              thumbnails={product.thumbnails || []}
              mainImage={mainImage}
              productName={product.name}
              onImageChange={setMainImage}
            />

            {/* 모바일 상품 정보 */}
            <ProductInfoMobile product={product} />

            {/* todo: 추천 상품 임시 비활성화 */}
            {/* <ProductRecommandSlider
              title="다른 원장님들이 함께 본 상품 BEST"
              products={recommendedProducts}
              onCartClick={(p) => addToCart({ variantId: p.id, quantity: 1 })}
              className="py-4 md:py-8"
              itemsPerView={{ mobile: 1.2, tablet: 2.5, desktop: 4 }}
            /> */}

            {/* 탭 네비게이션 */}
            <ProductTabs
              activeTab={activeTab}
              reviewCount={reviewCount}
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
              className="mb-8 rounded-lg bg-white px-4 py-6 md:px-6"
            >
              <ProductReviewSection
                productId={product.pimMasterId || product.id}
                totalReviews={product.reviewCount || 0}
                averageRating={product.rating || 0}
                onTotalChange={setReviewCount}
                onAverageRatingChange={setAverageRating}
              />
            </div>

            {/* todo: Q&A 임시 비활성화 */}
            {/* <div ref={qnaRef} id="qna-panel" role="tabpanel">
              <ProductQnaSection />
            </div> */}

            {/* 구매/반품 정보 */}
            <div ref={infoRef} id="info-panel" role="tabpanel">
              <ProductInfoAccordion />
            </div>
          </main>

          {/* 사이드바 (데스크탑)*/}
          <ProductSidebarPurchase
            product={product}
            isWishlisted={isWishlisted}
            isWishlistPending={isPending}
            onWishlistToggle={handleWishlistToggle}
            countryCode={countryCode}
            // isUser={!!user}
            quantity={quantity}
            onQuantityChange={setQuantity}
            selectedOptions={selectedOptions}
            selectedCartOptions={selectedCartOptions}
            onOptionChange={handleOptionChange}
            onQuantityUpdate={handleQuantityUpdate}
            onOptionRemove={handleOptionRemove}
            onAddToCart={handleDesktopAddToCart}
            onBuyNow={handleBuyNow}
            isAddToCartLoading={isAddToCartLoading}
            rating={averageRating}
            reviewCount={reviewCount}
          />
        </div>
      </div>

      {/* 모바일 하단 액션바 & 바텀시트 */}
      {isMounted &&
        createPortal(
          <>
            <ProductBottomBar
              isInWishlist={isWishlisted}
              wishlistLoading={isPending}
              hasOptions={!isSingleOption}
              onWishlistToggle={() => handleWishlistToggle(product.id)}
              onCartClick={openBottomSheet}
              onBuyClick={openBottomSheet}
            />
            <ProductBottomSheet
              isOpen={isBottomSheetOpen}
              product={product}
              quantity={quantity}
              onQuantityChange={setQuantity}
              getProductPrice={getProductPrice}
              getTotalPrice={getTotalPrice}
              isSingleOptionProduct={isSingleOption}
              isOutOfStock={isOutOfStock}
              showSuccessMessage={showSuccessMessage}
              onClose={closeBottomSheet}
              onAddToCart={handleAddToCart}
              onBuyNow={handleBuyNow}
              onGoToCart={handleGoToCart}
              selectedOptions={selectedOptions}
              selectedCartOptions={selectedCartOptions}
              onOptionChange={handleOptionChange}
              onQuantityUpdate={handleQuantityUpdate}
              onOptionRemove={handleOptionRemove}
            />
          </>,
          document.body
        )}

      {/* 로그인 필요 확인 모달 */}
      <AlertDialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <AlertDialogContent className="z-80">
          <AlertDialogHeader>
            <AlertDialogTitle>로그인이 필요합니다</AlertDialogTitle>
            <AlertDialogDescription>
              로그인이 필요한 기능입니다. 로그인 화면으로 이동하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleLoginConfirm}>
              로그인하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 장바구니 담기 성공 모달 */}
      <CartSuccessModal
        open={showCartSuccessModal}
        onOpenChange={setShowCartSuccessModal}
        onGoToCart={handleGoToCart}
        onContinueShopping={() => setShowCartSuccessModal(false)}
      />
    </div>
  )
}

export default ProductDetailPage
