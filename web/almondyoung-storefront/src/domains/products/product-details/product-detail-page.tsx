"use client"

import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { useWishlist } from "@/contexts/wishlist-context"
import { getQuestionsByProductId } from "@/lib/api/ugc"
import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { useRecentViews } from "@hooks/api/use-recent-views"
import type { ProductDetail } from "@lib/types/ui/product"
import type { UserDetail, WishlistItem } from "@lib/types/ui/user"
import { isProductSoldOut } from "@lib/utils"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { ProductDetailInfo } from "./components/product-detail-info"
import { ProductImageGallery } from "./components/product-image-gallery"
import { ProductInfoAccordion } from "./components/product-info-accordion"
import { ProductInfoMobile } from "./components/product-info-mobile"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductSidebarPurchase } from "./components/product-sidebar-purchase"
import { ProductQnaSection } from "./components"

// 초기 렌더에 필요 없는 컴포넌트 동적 임포트
const CartSuccessModal = dynamic(
  () =>
    import("@/components/modals/cart-success-modal").then(
      (mod) => mod.CartSuccessModal
    ),
  { ssr: false }
)
const AlertDialog = dynamic(
  () => import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialog),
  { ssr: false }
)
const AlertDialogAction = dynamic(() =>
  import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialogAction)
)
const AlertDialogCancel = dynamic(() =>
  import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialogCancel)
)
const AlertDialogContent = dynamic(() =>
  import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialogContent)
)
const AlertDialogDescription = dynamic(() =>
  import("@/components/ui/alert-dialog").then(
    (mod) => mod.AlertDialogDescription
  )
)
const AlertDialogFooter = dynamic(() =>
  import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialogFooter)
)
const AlertDialogHeader = dynamic(() =>
  import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialogHeader)
)
const AlertDialogTitle = dynamic(() =>
  import("@/components/ui/alert-dialog").then((mod) => mod.AlertDialogTitle)
)
const ReviewDetailCardList = dynamic(
  () =>
    import("@/domains/reviews/details").then((mod) => mod.ReviewDetailCardList),
  { ssr: false }
)
const ProductBottomBar = dynamic(
  () =>
    import("./components/product-bottom-bar").then(
      (mod) => mod.ProductBottomBar
    ),
  { ssr: false }
)
const ProductBottomSheet = dynamic(
  () =>
    import("./components/product-bottom-sheet").then(
      (mod) => mod.ProductBottomSheet
    ),
  { ssr: false }
)
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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isMembershipPricing } = useMembershipPricing()
  const {
    isLoaded,
    isWishlisted,
    isPending: isWishlistPending,
    toggle,
  } = useWishlist()

  type Tab = "detail" | "review" | "qna"
  const validTabs: Tab[] = ["detail", "review", "qna"]
  const tabParam = searchParams.get("tab") as Tab | null
  const initialTab: Tab =
    tabParam && validTabs.includes(tabParam) ? tabParam : "detail"
  const [activeTab, setActiveTabState] = useState<Tab>(initialTab)

  const setActiveTab = useCallback(
    (tab: Tab) => {
      setActiveTabState(tab)
      const params = new URLSearchParams(searchParams.toString())
      if (tab === "detail") {
        params.delete("tab")
      } else {
        params.set("tab", tab)
      }
      const query = params.toString()
      window.history.replaceState(
        null,
        "",
        `${pathname}${query ? `?${query}` : ""}`
      )
    },
    [pathname, searchParams]
  )
  const [mainImage, setMainImage] = useState(
    product?.thumbnails?.[0] || product?.thumbnail || ""
  )
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
  const [reviewCount, setReviewCount] = useState(0)
  const [averageRating, setAverageRating] = useState(0)
  const [qnaCount, setQnaCount] = useState(0)

  const [isPending, startTransition] = useTransition()

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

  useEffect(() => {
    if (!product) return
    const productId = product.pimMasterId || product.id

    getQuestionsByProductId({ productId, limit: 1 })
      .then((result) => setQnaCount(result.total ?? 0))
      .catch(() => setQnaCount(0))
  }, [product])

  if (error || !product) {
    return (
      <main className="lg:bg-muted/50 flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-600">
            {error || "상품을 불러올 수 없습니다."}
          </p>
        </div>
      </main>
    )
  }

  const resolvedWishlisted = isLoaded
    ? isWishlisted(product?.id || "")
    : !!wishlist

  const handleWishlistToggle = (productId: string) => {
    if (!user) {
      const path = getPathWithoutCountry(countryCode)
      router.push(
        `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
      )
      return
    }

    startTransition(async () => {
      try {
        await toggle(productId)
      } catch (error) {
        console.error("찜하기 실패", error)
        toast.error("찜 처리 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }
    })
  }

  const isSingleOption = !product.options || product.options.length === 0
  const isOutOfStock = product.status !== "active"
  const isSoldOut = isProductSoldOut(product)

  // 단일 옵션 상품 수량 변경 (재고 초과 시 자동 조정)
  const handleSingleOptionQuantityChange = (newQuantity: number) => {
    if (newQuantity < 1) {
      setQuantity(1)
      return
    }
    const maxStock = product.available
    const adjustedQuantity =
      product.manageInventory && maxStock !== Infinity && newQuantity > maxStock
        ? maxStock
        : newQuantity
    setQuantity(adjustedQuantity)
  }

  // 선택된 옵션을 기반으로 각 옵션 값의 품절 여부 계산
  const optionsWithSoldOut = useMemo(() => {
    const options = product.options ?? []
    const optionOrder = options.map((o) => o.label)

    return options.map((option, optionIndex) => ({
      ...option,
      values: option.values.map((value) => {
        // 이전 옵션들이 모두 선택되었는지 확인
        const prevOptionsSelected = optionOrder
          .slice(0, optionIndex)
          .every((label) => !!selectedOptions[label])

        if (!prevOptionsSelected) {
          // 이전 옵션이 선택되지 않으면 품절 여부 알 수 없음
          return { ...value, isSoldOut: false }
        }

        // 이전 옵션들 + 현재 값으로 조합 테스트
        const testSelection = {
          ...Object.fromEntries(
            optionOrder
              .slice(0, optionIndex)
              .map((label) => [label, selectedOptions[label]])
          ),
          [option.label]: value.name,
        }

        // 남은 옵션들의 모든 조합 확인
        const remainingOptions = options.slice(optionIndex + 1)

        if (remainingOptions.length === 0) {
          // 마지막 옵션이면 바로 재고 확인
          const selectionKey = optionOrder
            .map((label) => `${label}=${testSelection[label]}`)
            .join("|")
          const variantId = product.skuIndex?.[selectionKey]
          const stock = variantId ? product.skuStock?.[variantId] : undefined
          const isSoldOut =
            stock !== undefined && stock !== Infinity && stock <= 0
          return { ...value, isSoldOut }
        }

        // 남은 옵션들의 모든 조합을 확인해서 하나라도 재고 있으면 품절 아님
        const checkAllCombinations = (
          currentSelection: Record<string, string>,
          remainingOpts: typeof remainingOptions
        ): boolean => {
          if (remainingOpts.length === 0) {
            const selectionKey = optionOrder
              .map((label) => `${label}=${currentSelection[label]}`)
              .join("|")
            const variantId = product.skuIndex?.[selectionKey]
            const stock = variantId ? product.skuStock?.[variantId] : undefined
            // 재고 있으면 true (품절 아님)
            return stock === undefined || stock === Infinity || stock > 0
          }

          const [nextOption, ...rest] = remainingOpts
          for (const nextValue of nextOption.values) {
            const hasStock = checkAllCombinations(
              { ...currentSelection, [nextOption.label]: nextValue.name },
              rest
            )
            if (hasStock) return true // 하나라도 재고 있으면 품절 아님
          }
          return false // 모든 조합 품절
        }

        const hasAnyStock = checkAllCombinations(
          testSelection,
          remainingOptions
        )
        return { ...value, isSoldOut: !hasAnyStock }
      }),
    }))
  }, [product.options, product.skuIndex, product.skuStock, selectedOptions])

  const getVariantPrice = (variantId?: string) => {
    const resolvePrice = (base?: number, actual?: number) => {
      const basePrice = base ?? 0
      const actualPrice = actual ?? basePrice
      if (!isMembershipPricing) {
        return basePrice
      }

      if (actualPrice > 0 && actualPrice < basePrice) {
        return actualPrice
      }

      const fallbackMembershipPrice = product.membershipPrice
      if (
        typeof fallbackMembershipPrice === "number" &&
        fallbackMembershipPrice > 0 &&
        fallbackMembershipPrice < basePrice
      ) {
        return fallbackMembershipPrice
      }

      return actualPrice
    }
    if (variantId && variantId === product.defaultVariantId) {
      return resolvePrice(product.basePrice, product.actualPrice)
    }
    if (variantId && product.variantPriceMap?.[variantId]) {
      const price = product.variantPriceMap[variantId]
      return resolvePrice(price.basePrice, price.actualPrice)
    }
    return resolvePrice(product.basePrice, product.actualPrice)
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

    // 품절 체크
    const variantStock = product.skuStock?.[variantId]
    const isSoldOut =
      variantStock !== undefined &&
      variantStock !== Infinity &&
      variantStock <= 0

    if (isSoldOut) {
      toast.error("선택한 옵션은 품절입니다.")
      setSelectedOptions({})
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
          stock: variantId ? product.skuStock?.[variantId] : undefined,
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
        prev.map((opt) => {
          if (opt.id !== id) return opt
          // 재고 초과 시 최대 수량으로 자동 조정
          const maxStock = opt.stock
          const adjustedQuantity =
            maxStock !== undefined &&
            maxStock !== Infinity &&
            newQuantity > maxStock
              ? maxStock
              : newQuantity
          return { ...opt, quantity: adjustedQuantity }
        })
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
    // 단일 옵션 상품 품절 체크
    if (isSingleOption && isSoldOut) {
      toast.error("품절된 상품입니다.")
      return false
    }

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
    const path = getPathWithoutCountry(countryCode)
    router.push(
      `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
    )
  }

  const handleGoToCart = () => {
    router.push(`/${countryCode}/cart`)
  }

  // todo: 추천상품 임시 비활성화
  // const recommendedProducts: ProductCard[] = []

  return (
    <div className="lg:bg-muted/50 min-h-screen bg-white">
      {/* todo: 상품 상세 상단 breadcrumb 임시 비활성화 */}
      {/* <Breadcrumb /> */}

      <div className="mx-auto max-w-[1360px] px-[15px] lg:px-[40px]">
        <div className="py-2 lg:flex lg:gap-4">
          {/* 메인 콘텐츠 */}
          <main className="w-full min-w-0 flex-1 pb-24 lg:pb-0">
            {/* 이미지 갤러리 */}
            <ProductImageGallery
              thumbnails={product.thumbnails || []}
              mainImage={mainImage}
              productName={product.name}
              onImageChange={setMainImage}
              isSoldOut={isSoldOut}
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

            {/* 탭 네비게이션 + 콘텐츠 */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as Tab)}
              className="w-full"
            >
              <TabsList className="sticky top-0 z-10 mb-8 inline-flex h-auto w-full rounded-none border-b border-[#e5e5e5] bg-white p-0">
                <TabsTrigger
                  value="detail"
                  className="flex-1 rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-bold text-[#666666] shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-[#f29219] data-[state=active]:bg-transparent data-[state=active]:text-[#f29219] data-[state=active]:shadow-none data-[state=inactive]:hover:text-[#333333] lg:text-base"
                >
                  상세정보
                </TabsTrigger>
                <TabsTrigger
                  value="review"
                  className="flex-1 rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-bold text-[#666666] shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-[#f29219] data-[state=active]:bg-transparent data-[state=active]:text-[#f29219] data-[state=active]:shadow-none data-[state=inactive]:hover:text-[#333333] lg:text-base"
                >
                  리뷰
                  {reviewCount > 0 && (
                    <span className="ml-0.5 text-[0.65em] tabular-nums opacity-80">
                      {reviewCount.toLocaleString()}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="qna"
                  className="flex-1 rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-bold text-[#666666] shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-[#f29219] data-[state=active]:bg-transparent data-[state=active]:text-[#f29219] data-[state=active]:shadow-none data-[state=inactive]:hover:text-[#333333] lg:text-base"
                >
                  Q&A
                  {qnaCount > 0 && (
                    <span className="ml-0.5 text-[0.65em] tabular-nums opacity-80">
                      {qnaCount.toLocaleString()}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detail">
                <ProductDetailInfo
                  productInfo={product.productInfo || {}}
                  descriptionHtml={product.descriptionHtml}
                  detailImages={product.detailImages || []}
                  productName={product.name}
                />
                <ProductInfoAccordion />
              </TabsContent>

              <TabsContent
                value="review"
                className="mb-8 rounded-lg bg-white px-4 py-6 lg:px-6"
              >
                <ReviewDetailCardList
                  countryCode={countryCode}
                  productId={product.pimMasterId || product.id}
                  totalReviews={0}
                  averageRating={0}
                  onTotalChange={setReviewCount}
                  onAverageRatingChange={setAverageRating}
                />
              </TabsContent>

              <TabsContent value="qna">
                <ProductQnaSection />
              </TabsContent>
            </Tabs>
          </main>

          {/* 사이드바 (데스크탑)*/}
          <ProductSidebarPurchase
            product={product}
            isWishlisted={resolvedWishlisted}
            isWishlistPending={isPending || isWishlistPending(product.id)}
            onWishlistToggle={handleWishlistToggle}
            countryCode={countryCode}
            // isUser={!!user}
            quantity={quantity}
            onQuantityChange={handleSingleOptionQuantityChange}
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
            optionsWithSoldOut={optionsWithSoldOut}
            isSoldOut={isSoldOut}
          />
        </div>
      </div>

      {/* 모바일 하단 액션바 & 바텀시트 */}
      {isMounted &&
        createPortal(
          <>
            <ProductBottomBar
              isInWishlist={resolvedWishlisted}
              wishlistLoading={isPending || isWishlistPending(product.id)}
              hasOptions={!isSingleOption}
              onWishlistToggle={() => handleWishlistToggle(product.id)}
              onCartClick={openBottomSheet}
              onBuyClick={openBottomSheet}
            />
            <ProductBottomSheet
              isOpen={isBottomSheetOpen}
              product={product}
              quantity={quantity}
              onQuantityChange={handleSingleOptionQuantityChange}
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
              optionsWithSoldOut={optionsWithSoldOut}
              isSoldOut={isSoldOut}
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
