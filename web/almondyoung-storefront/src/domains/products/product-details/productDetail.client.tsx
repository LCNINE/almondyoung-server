"use client"

import { CustomButton } from "@components/common/custom-buttons/custom-button"
import { Breadcrumb } from "@components/layout/components/breadcrumb"
import { ProductCard } from "@lib/types/ui/product"
import { SingleOptionQuantitySelector } from "app/[countryCode]/(main)/products/components/single-option-quantity-selector"
import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Heart,
  HelpCircle,
  MessageCircle,
  Minus,
  Plus,
  ShoppingCart,
  Star,
  X,
  Zap,
} from "lucide-react"
import React, { use, useRef, useState } from "react"

import { AnimatedMembershipText } from "@components/products/atomics/animated-membership-text"
import { useAddToCart } from "@hooks/api/use-add-to-cart"
import { useRecentViews } from "@hooks/api/use-recent-views"
import { useWishlist } from "@hooks/api/use-wishlist"
import type { ProductDetail } from "@lib/types/ui/product"
import { UserBasicInfo } from "@lib/types/ui/user"
import { getRecommendedProducts } from "app/data/__mocks__/recommended-products.mock"
import MembershipTagIcon from "icons/membership-tag-icon"
import Image from "next/image"
import { ProductRecommandSlider } from "components/product-recommand-slider"

interface ProductDetailPageProps {
  params: Promise<{
    id: string
    countryCode: string
  }>
  product: ProductDetail | null
  error?: string | null
  user: UserBasicInfo | null
}

const ProductDetailPage: React.FC<ProductDetailPageProps> = ({
  params,
  product,
  error,
  user,
}) => {
  const resolvedParams = use(params)
  const { countryCode } = resolvedParams

  // 에러 처리
  if (error || !product) {
    return (
      <div className="md:bg-muted/50 flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-600">
            {error || "상품을 불러올 수 없습니다."}
          </p>
        </div>
      </div>
    )
  }

  // 기본 상태
  const [activeTab, setActiveTab] = useState("detail")
  const [quantity, setQuantity] = useState(1)
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({})
  const [mainImage, setMainImage] = useState(
    product.thumbnails?.[0] || product.thumbnail
  )
  const [accordionStates, setAccordionStates] = useState({
    payment: false,
    shipping: false,
    return: false,
  })
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false)
  const [showSuccessMessage, setShowSuccessMessage] = useState(false)

  // 선택된 옵션 조합들 (장바구니 담기 전)
  const [selectedCartOptions, setSelectedCartOptions] = useState<
    Array<{
      id: string
      name: string
      quantity: number
      price: number
      image: string
    }>
  >([])

  // Hooks
  const { addToCart } = useAddToCart()
  const {
    toggleItem,
    isInWishlist,
    isLoading: wishlistLoading,
  } = useWishlist(user)

  // 자동 최근 본 상품 추가
  useRecentViews(null, {
    userId: user?.id,
    useCache: true,
    autoAdd: {
      productId: product.id,
      delay: 2000,
      addOnce: true,
    },
  })

  // 탭 섹션 refs
  const detailRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const qnaRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)

  // ===== 유틸 함수 (최소 로직) =====

  // 단일 옵션 여부
  const isSingleOptionProduct = () =>
    !product.options || product.options.length === 0

  /**
   * 상품 가격 (서버 데이터 기반)
   * 📡 서버: basePrice, membershipPrice 제공
   * 💻 프론트: 우선순위만 결정
   */
  const getProductPrice = () => {
    return product.membershipPrice || product.basePrice || 0
  }

  /**
   * 품절 여부 (서버 판단)
   * 📡 서버: status 제공
   */
  const isOutOfStock = () => {
    return product.status !== "active"
  }

  /**
   * 할인율 계산 (프론트 책임 - 단순 수식)
   * 💻 프론트: 가격 기반 할인율 계산
   */
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    const member = product.membershipPrice || 0
    if (base > 0 && member > 0 && member < base) {
      return Math.round(((base - member) / base) * 100)
    }
    return 0
  }
  // 탭 스크롤 함수
  const scrollToSection = (tab: string) => {
    const refs = {
      detail: detailRef,
      review: reviewRef,
      qna: qnaRef,
      info: infoRef,
    }

    const targetRef = refs[tab as keyof typeof refs]
    if (targetRef?.current) {
      targetRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }
  }

  /**
   * 추천 상품 데이터 (서버 데이터 그대로)
   * 📡 서버: 상품 리스트 제공
   * 💻 프론트: 최소 변환 (호환성 위해 일부 필드만 추가)
   */
  const recommendedProducts = getRecommendedProducts().map((product) => ({
    id: product.id,
    name: product.name,
    thumbnail: product.thumbnail,
    basePrice: product.basePrice,
    membershipPrice: product.membershipPrice,
    isMembershipOnly: product.isMembershipOnly,
    status: product.status,
    rating: product.rating,
    reviewCount: product.reviewCount,
    stock: product.stock,
    optionMeta: product.optionMeta,
  })) as ProductCard[]

  // 핸들러 함수들
  const handleOptionChange = (optionLabel: string, value: string) => {
    const next = { ...selectedOptions, [optionLabel]: value }
    setSelectedOptions(next)

    // 모든 옵션이 선택되었는지 확인
    const allSelected = (product.options ?? []).every((o) => !!next[o.label])
    if (!allSelected) return

    // 옵션 조합으로 장바구니 항목 추가
    const optionName = (product.options ?? [])
      .map((o) => next[o.label])
      .join(" / ")

    setSelectedCartOptions((prev) => {
      const exists = prev.find((p) => p.name === optionName)
      if (exists) {
        return prev.map((p) =>
          p.name === optionName ? { ...p, quantity: p.quantity + 1 } : p
        )
      }
      return [
        ...prev,
        {
          id: `${product.id}-${Date.now()}`,
          name: optionName,
          quantity: 1,
          price: getProductPrice(),
          image: product.thumbnails?.[0] || product.thumbnail,
        },
      ]
    })

    // 선택 초기화
    setSelectedOptions({})
  }

  const addToCartHandler = () => {
    // 단일 옵션 상품
    if (isSingleOptionProduct()) {
      addToCart({
        variantId: product.id,
        quantity,
      })
      return
    }

    // 옵션이 있는 상품 - 선택된 옵션들 추가
    selectedCartOptions.forEach((option) => {
      addToCart({
        variantId: product.id,
        quantity: option.quantity,
      })
    })
  }

  // Alias for backward compatibility
  const addOptionToCart = addToCartHandler

  const handleWishlistToggle = async () => {
    try {
      await toggleItem(product.id)
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "위시리스트 처리에 실패했습니다."

      if (
        errorMessage.includes("로그인") ||
        errorMessage.includes("401") ||
        errorMessage.includes("authentication")
      ) {
        if (confirm("로그인이 필요합니다. 로그인 페이지로 이동하시겠습니까?")) {
          window.location.href = `/${countryCode}/auth/login`
        }
        return
      }
      alert(errorMessage)
    }
  }

  const updateQuantity = (id: string, newQuantity: number) => {
    if (newQuantity < 1) {
      setSelectedCartOptions(selectedCartOptions.filter((opt) => opt.id !== id))
    } else {
      setSelectedCartOptions(
        selectedCartOptions.map((opt) =>
          opt.id === id ? { ...opt, quantity: newQuantity } : opt
        )
      )
    }
  }

  const removeOption = (id: string) => {
    setSelectedCartOptions(selectedCartOptions.filter((opt) => opt.id !== id))
  }

  const getTotalQuantity = () => {
    const cartQuantity = selectedCartOptions.reduce(
      (sum, opt) => sum + opt.quantity,
      0
    )
    // 단일 옵션 상품의 경우 quantity 상태도 포함
    return isSingleOptionProduct() ? cartQuantity + quantity : cartQuantity
  }

  const getTotalPrice = () => {
    const totalQty = getTotalQuantity()
    const unitPrice = getProductPrice()
    return totalQty * unitPrice
  }

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      {/* 브레드크럼 */}
      <Breadcrumb />
      <div className="mx-auto max-w-[1360px] px-[15px] md:px-[40px]">
        <div className="py-2 md:flex md:gap-4">
          {/* Left Column - Product Images & Details */}
          <div className="w-full min-w-0 flex-1">
            {/* Product Images */}
            <div className="mb-8 flex flex-col gap-4 px-0 md:flex-col-reverse lg:flex-row lg:px-14">
              <div className="relative hidden md:flex md:flex-row lg:flex-col">
                {/* 좌측 스크롤 버튼 */}
                <button
                  onClick={() => {
                    const container =
                      document.getElementById("thumbnail-scroll")
                    if (container) {
                      container.scrollBy({ left: -100, behavior: "smooth" })
                    }
                  }}
                  className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full bg-white/80 p-1 shadow-md hover:bg-white lg:hidden"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>

                {/* 썸네일 컨테이너 */}
                <div
                  id="thumbnail-scroll"
                  className="flex gap-2 overflow-x-auto md:flex-row lg:flex-col"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {product?.thumbnails?.map((thumb: string, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setMainImage(thumb)}
                      className="h-20 w-20 min-w-20 flex-shrink-0 overflow-hidden bg-gray-200"
                    >
                      <img
                        src={thumb}
                        alt={`상품 이미지 ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>

                {/* 우측 스크롤 버튼 */}
                <button
                  onClick={() => {
                    const container =
                      document.getElementById("thumbnail-scroll")
                    if (container) {
                      container.scrollBy({ left: 100, behavior: "smooth" })
                    }
                  }}
                  className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full bg-white/80 p-1 shadow-md hover:bg-white lg:hidden"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex-1">
                <div className="aspect-square overflow-hidden bg-gray-200">
                  <img
                    src={product?.thumbnails?.[0] || mainImage}
                    alt="상품 메인 이미지"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>

              {/* 작은 썸네일 Mobile View */}
              <div className="flex flex-row gap-2 md:hidden">
                {product.thumbnails?.map((thumb: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setMainImage(thumb)}
                    className="h-20 w-20 overflow-hidden bg-gray-200"
                  >
                    <img
                      src={thumb}
                      alt={`상품 이미지 ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* 모바일일때만 보이는 제품상세정보 섹션 Brand & Product Name mobile view*/}
            <div className="md:hidden">
              <div className="mb-4">
                <p className="text-sm text-gray-600">{product?.brand}</p>
                <h2 className="text-xl font-bold">{product?.name}</h2>
              </div>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className="h-5 w-5 fill-yellow-400 text-yellow-400"
                    />
                  ))}
                </div>
                <span className="text-sm">{product?.reviewCount}개의 리뷰</span>
              </div>

              {/* Price (모바일) */}
              <div className="mb-6 md:hidden">
                {/* 멤버십 태그 */}
                {!product?.isMembershipOnly && getDiscountRate() > 0 && (
                  <div className="inline-flex max-w-[120px] items-center">
                    <MembershipTagIcon />
                  </div>
                )}

                <div className="mb-4 flex items-baseline gap-2">
                  {product?.isMembershipOnly ? (
                    /* 멤버십 전용 */
                    <>
                      <span className="text-gray-400 line-through">
                        {product?.basePrice?.toLocaleString()}원
                      </span>
                      <AnimatedMembershipText
                        className="text-2xl font-bold"
                        delay={800}
                        duration={2000}
                      />
                    </>
                  ) : (
                    /* 일반 상품 */
                    <>
                      {getDiscountRate() > 0 && (
                        <>
                          <span className="text-gray-400 line-through">
                            {product?.basePrice?.toLocaleString()}원
                          </span>
                          <span className="text-2xl font-bold text-red-500">
                            {getDiscountRate()}%
                          </span>
                        </>
                      )}
                      <span className="text-2xl font-bold">
                        {getProductPrice().toLocaleString()}원
                      </span>
                    </>
                  )}
                </div>

                {/* 멤버십 등급별 가격 */}
                {product?.memberPrices && product.memberPrices.length > 0 && (
                  <div className="bg-muted space-y-1.5 p-4">
                    {product.memberPrices.map((price: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>{price.range} 구매 시</span>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500">{price.rate}%</span>
                          <span className="font-medium">
                            개당 {price.price.toLocaleString()}원
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Shipping Info */}
              <div className="my-4 border-y py-4">
                <div className="space-y-2 text-sm">
                  <div className="flex">
                    <span className="w-32 text-gray-600">국내 / 해외배송</span>
                    <span>{product?.shipping?.type}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 text-gray-600">배송방법</span>
                    <span>{product?.shipping?.method}</span>
                  </div>
                  {product?.shipping?.cost && (
                    <div className="flex">
                      <span className="w-32 text-gray-600">배송비</span>
                      <span>
                        {product.shipping.cost} {product.shipping.shipmentInfo}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center">
                    <span className="w-32 text-gray-600">
                      평균 재입고 소요일
                    </span>
                    <span>{product?.shipping?.averageRestockDays}일</span>
                    <HelpCircle className="ml-1 h-3 w-3 text-gray-400" />
                  </div>
                </div>
              </div>
              {/* 단일 옵션 제품의 수량 조절 (모바일) */}
              {isSingleOptionProduct() && (
                <SingleOptionQuantitySelector
                  productName={product?.name || ""}
                  thumbnail={product?.thumbnails?.[0]}
                  quantity={quantity}
                  onQuantityChange={setQuantity}
                  price={getProductPrice()}
                  stock={0}
                  className="mb-6"
                  showTitle={true}
                />
              )}
              {/* Options Selection */}
              {product?.options && product.options.length > 0 && (
                <div className="space-y-4">
                  {product.options.map((option: any) => (
                    <div key={option.label} className="mb-4">
                      <div className="mb-2">
                        <span className="text-sm font-medium text-gray-700">
                          {option.label} 선택
                        </span>
                      </div>
                      <div
                        className={`flex gap-2 ${
                          option.values.length >= 7 ||
                          product?.options?.length >= 3
                            ? "overflow-x-auto pb-2"
                            : "flex-wrap"
                        }`}
                        style={{
                          scrollbarWidth: "none",
                          msOverflowStyle: "none",
                        }}
                      >
                        {option.values.map((value: any) => {
                          const isSelected =
                            selectedOptions[option.label] === value.name
                          const isDisabled = value.disabled || false

                          return (
                            <button
                              key={value.id}
                              onClick={() =>
                                handleOptionChange(option.label, value.name)
                              }
                              disabled={isDisabled}
                              className={`flex-shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                                isSelected
                                  ? "border-blue-500 bg-blue-500 text-white"
                                  : isDisabled
                                    ? "bg-muted0 cursor-not-allowed border-gray-200 text-gray-400"
                                    : "border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                              }`}
                            >
                              {value.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Selected Options */}
                  {selectedCartOptions.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {selectedCartOptions.map((option: any) => (
                        <div
                          key={option.id}
                          className="flex items-center gap-3 rounded-lg bg-white py-3"
                        >
                          <Image
                            src={option.image || product?.thumbnail || ""}
                            alt={option.name}
                            width={60}
                            height={60}
                            className="rounded-lg"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{option.name}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {option.price?.toLocaleString()}원
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateQuantity(option.id, -1)}
                                className="h-6 w-6 rounded-full border text-xs"
                              >
                                -
                              </button>
                              <span className="text-sm">{option.quantity}</span>
                              <button
                                onClick={() => updateQuantity(option.id, 1)}
                                className="h-6 w-6 rounded-full border text-xs"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <button
                            onClick={() => removeOption(option.id)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add to Cart Button */}
                  {/* <div className="mt-6 flex gap-2">
                    <CustomButton
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      onClick={addOptionToCart}
                      disabled={!isAllOptionsSelected()}
                    >
                      장바구니 담기
                    </CustomButton>
                    <CustomButton
                      variant="default"
                      size="lg"
                      className="flex-1"
                      onClick={buyNow}
                      disabled={!isAllOptionsSelected()}
                    >
                      바로구매
                    </CustomButton>
                  </div> */}
                </div>
              )}
            </div>

            {/* Recommended Products */}
            <ProductRecommandSlider
              title="다른 원장님들이 함께 본 상품 BEST"
              products={recommendedProducts}
              onCartClick={(product) =>
                addToCart({
                  variantId: product.id,
                  quantity: 1,
                })
              }
              className="py-4 md:py-8"
              itemsPerView={{
                mobile: 1.2,
                tablet: 2.5,
                desktop: 4,
              }}
            />

            {/* Product Info Tabs */}
            <div className="sticky top-0 z-10 mb-8 rounded-lg bg-white">
              <div className="flex border-b">
                {["detail", "review", "qna", "info"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab)
                      scrollToSection(tab)
                    }}
                    className={`flex-1 py-4 text-center ${activeTab === tab ? "border-b-2 border-blue-500 text-blue-500" : "text-gray-600"}`}
                  >
                    {tab === "detail" && "상세정보"}
                    {tab === "review" && `리뷰 ${product?.reviewCount}`}
                    {tab === "qna" && `Q&A ${product?.qnaCount || 0}`}
                    {tab === "info" && "구매, 반품/교환 정보안내"}
                  </button>
                ))}
              </div>
            </div>

            {/* 상세정보 섹션 */}
            <div ref={detailRef} className="bg-white px-0 py-6 md:px-6">
              <div>
                <div>
                  <h3 className="mb-4 text-lg font-bold">상품정보</h3>
                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    {[
                      { key: "productNumber", label: "상품번호" },
                      { key: "weight", label: "상품 무게" },
                      { key: "dimensions", label: "상품 규격" },
                      { key: "origin", label: "원산지" },
                      { key: "capacity", label: "용량" },
                      { key: "expirationDate", label: "유효일자" },
                      { key: "manufacturer", label: "제조사" },
                      { key: "brand", label: "브랜드" },
                      { key: "material", label: "소재" },
                      { key: "usage", label: "사용방법" },
                    ].map(({ key, label }) => {
                      const value = product?.productInfo?.[key] || ""
                      return (
                        <div
                          key={key}
                          className={`border-b pb-2 ${key === "material" || key === "usage" ? "md:col-span-2" : ""}`}
                        >
                          {key === "material" || key === "usage" ? (
                            <div className="flex">
                              <div className="mb-1 w-32 text-gray-500">
                                {label}
                              </div>
                              <div className="text-gray-900">{value}</div>
                            </div>
                          ) : (
                            <div className="flex">
                              <span className="w-32 text-gray-500">
                                {label}
                              </span>
                              <span className="flex-1">{value}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Product Detail Images */}
                  <div className="mt-8 space-y-4">
                    {(product?.detailImages || []).map(
                      (image: string, idx: number) => (
                        <div
                          key={idx}
                          className="w-full overflow-hidden rounded-lg"
                        >
                          <img
                            src={image}
                            alt={`상품 상세 이미지 ${idx + 1}`}
                            className="h-auto w-full object-contain"
                            loading="lazy"
                            onError={(e) =>
                              console.error("이미지 로드 실패:", image, e)
                            }
                          />
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* 리뷰 섹션 */}
              <div ref={reviewRef} className="mb-8 rounded-lg bg-white py-6">
                <div>
                  <div>
                    <div className="mb-6 flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className="h-5 w-5 fill-yellow-400 text-yellow-400"
                            />
                          ))}
                        </div>
                        <span className="text-2xl font-bold">
                          {product?.rating}
                        </span>
                      </div>
                      <span className="text-gray-500">
                        평균 {product?.rating}
                      </span>
                    </div>

                    <div className="mb-6">
                      <div className="mb-3 flex items-center gap-2">
                        <h4 className="font-bold">리뷰요약</h4>
                        <span className="text-sm text-gray-500">
                          구매하신 분들의 리뷰를 분석했어요!
                        </span>
                      </div>
                      {/* <div className="flex flex-wrap gap-2">
                        {reviewKeywords.map((keyword, idx) => (
                          <span
                            key={idx}
                            className="rounded-full bg-muted0 px-3 py-1 text-sm"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div> */}
                    </div>

                    {/* Review Images */}
                    <div className="mb-6 flex gap-2 overflow-x-auto">
                      {[1, 2, 3, 4, 5, 6, 7].map((img) => (
                        <div
                          key={img}
                          className="h-24 w-24 flex-shrink-0 rounded-lg bg-gray-200"
                        />
                      ))}
                      <button className="bg-muted0 flex h-24 w-24 flex-shrink-0 flex-col items-center justify-center rounded-lg">
                        <span className="font-bold">100</span>
                        <span className="text-xs">더보기</span>
                      </button>
                    </div>

                    {/* Review List */}
                    <div className="space-y-6">
                      {[].map((review: any) => (
                        <div key={review.id} className="border-b pb-6">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="font-medium">{review.author}</span>
                            <span className="bg-muted0 rounded px-2 py-1 text-xs">
                              {review.authorType}
                            </span>
                            {review.isRepurchase && (
                              <span className="bg-muted0 rounded px-2 py-1 text-xs">
                                재구매
                              </span>
                            )}
                          </div>
                          <div className="mb-2 flex items-center gap-2">
                            <div className="flex">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-4 w-4 ${star <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
                                />
                              ))}
                            </div>
                            <span className="text-sm text-gray-500">
                              {review.date}
                            </span>
                          </div>
                          <div className="mb-3 rounded bg-gray-50 p-2">
                            <span className="text-sm">
                              {review.productVariant}
                            </span>
                          </div>
                          <p className="mb-3 text-sm">{review.content}</p>
                          {review.images && review.images.length > 0 && (
                            <div className="mb-3 flex gap-2">
                              {review.images.map((img: string, idx: number) => (
                                <div
                                  key={idx}
                                  className="h-16 w-16 rounded bg-gray-200"
                                />
                              ))}
                            </div>
                          )}
                          <button className="text-sm text-gray-500">
                            ♥ {review.likes}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Q&A 섹션 */}
              <div ref={qnaRef} className="mb-8 rounded-lg bg-white py-6">
                <div>
                  <h3 className="mb-4 text-lg font-bold">Q&A</h3>
                  <div className="py-8 text-center text-gray-500">
                    <p>아직 등록된 Q&A가 없습니다.</p>
                    <p className="mt-2 text-sm">
                      궁금한 점이 있으시면 언제든 문의해주세요!
                    </p>
                  </div>
                </div>
              </div>

              {/* 구매, 반품/교환 정보안내 섹션 */}
              <div ref={infoRef} className="mb-8 rounded-lg bg-white py-6">
                <div>
                  <div className="space-y-4">
                    {/* Payment Info */}
                    <div className="rounded-lg border">
                      <button
                        onClick={() =>
                          setAccordionStates({
                            ...accordionStates,
                            payment: !accordionStates.payment,
                          })
                        }
                        className="flex w-full items-center justify-between p-4"
                      >
                        <span className="font-medium">결제안내</span>
                        {accordionStates.payment ? (
                          <ChevronUp />
                        ) : (
                          <ChevronDown />
                        )}
                      </button>
                      {accordionStates.payment && (
                        <div className="px-4 pb-4">
                          <p className="text-sm text-gray-600">
                            고액 결제의 경우 안전을 위해 카드사에서 확인 전화를
                            드릴 수도 있습니다. 확인 과정에서 도난 카드의
                            사용이나 타인 명의의 주문 등 정상적인 주문이
                            아니라고 판단될 경우 임의로 주문을 보류 또는 취소할
                            수 있습니다.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Shipping Info */}
                    <div className="rounded-lg border">
                      <button
                        onClick={() =>
                          setAccordionStates({
                            ...accordionStates,
                            shipping: !accordionStates.shipping,
                          })
                        }
                        className="flex w-full items-center justify-between p-4"
                      >
                        <span className="font-medium">배송 안내</span>
                        {accordionStates.shipping ? (
                          <ChevronUp />
                        ) : (
                          <ChevronDown />
                        )}
                      </button>
                      {accordionStates.shipping && (
                        <div className="px-4 pb-4">
                          <p className="text-sm text-gray-600">
                            배송 방법 : 택배
                            <br />
                            배송 지역 : 전국지역
                            <br />
                            배송 비용 : 2,500원
                            <br />
                            배송 기간 : 2일 ~ 3일
                            <br />
                            배송 안내 : 택배사는 CJ 대한통운입니다.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Return Info */}
                    <div className="rounded-lg border">
                      <button
                        onClick={() =>
                          setAccordionStates({
                            ...accordionStates,
                            return: !accordionStates.return,
                          })
                        }
                        className="flex w-full items-center justify-between p-4"
                      >
                        <span className="font-medium">교환/반품 안내</span>
                        {accordionStates.return ? (
                          <ChevronUp />
                        ) : (
                          <ChevronDown />
                        )}
                      </button>
                      {accordionStates.return && (
                        <div className="px-4 pb-4">
                          <p className="text-sm text-gray-600">
                            교환 및 반품 주소
                            <br />
                            - 경기도 부천시 평천로 832번길 42 4층 엘씨나인
                            <br />
                            <br />
                            교환 및 반품이 가능한 경우
                            <br />- 상품을 공급 받으신 날로부터 7일 이내
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Fixed Purchase Section */}
          <div className="hidden w-full min-w-[383px] overflow-y-auto md:sticky md:top-0 md:block md:max-h-screen md:max-w-[383px] lg:max-w-[480px]">
            <div className="h-full bg-white p-6">
              {/* Brand & Product Name */}
              <div className="flex justify-between gap-4">
                <div className="mb-4">
                  <p className="text-sm text-gray-600">{product?.brand}</p>
                  <h2 className="text-xl font-bold">{product?.name}</h2>
                </div>
                <div className="flex gap-2">
                  <CustomButton
                    variant="secondary"
                    size="default"
                    onClick={handleWishlistToggle}
                    disabled={wishlistLoading}
                  >
                    <Heart
                      className={`h-7 w-7 ${
                        isInWishlist(product?.id || "")
                          ? "text-red-500"
                          : "text-gray-300"
                      }`}
                    />{" "}
                    찜
                  </CustomButton>
                  <CustomButton variant="secondary" size="default">
                    <MessageCircle className="h-7 w-7" />
                    챗봇
                  </CustomButton>
                </div>
              </div>

              {/* Rating */}
              <div className="mb-4 flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className="h-5 w-5 fill-yellow-400 text-yellow-400"
                    />
                  ))}
                </div>
                <span className="text-sm">{product?.reviewCount}개의 리뷰</span>
              </div>

              {/* Price (데스크톱) */}
              <div className="mb-6">
                {/* 멤버십 태그 */}
                {!product?.isMembershipOnly && getDiscountRate() > 0 && (
                  <div className="inline-flex max-w-[120px] items-center">
                    <MembershipTagIcon />
                  </div>
                )}

                <div className="mb-4 flex items-baseline gap-2">
                  {product?.isMembershipOnly ? (
                    /* 멤버십 전용 */
                    <>
                      <span className="text-gray-400 line-through">
                        {product?.basePrice?.toLocaleString()}원
                      </span>
                      <AnimatedMembershipText
                        className="text-2xl font-bold"
                        delay={800}
                        duration={2000}
                      />
                    </>
                  ) : (
                    /* 일반 상품 */
                    <>
                      {getDiscountRate() > 0 && (
                        <>
                          <span className="text-gray-400 line-through">
                            {product?.basePrice?.toLocaleString()}원
                          </span>
                          <span className="text-2xl font-bold text-red-500">
                            {getDiscountRate()}%
                          </span>
                        </>
                      )}
                      <span className="text-2xl font-bold">
                        {getProductPrice().toLocaleString()}원
                      </span>
                    </>
                  )}
                </div>

                {/* 멤버십 등급별 가격 */}
                {product?.memberPrices && product.memberPrices.length > 0 && (
                  <div className="bg-muted space-y-1.5 p-4">
                    {product.memberPrices.map((price: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>{price.range} 구매 시</span>
                        <div className="flex items-center gap-2">
                          <span className="text-red-500">{price.rate}%</span>
                          <span className="font-medium">
                            개당 {price.price.toLocaleString()}원
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Shipping Info */}
              <div className="border-gray-20 mb-4 border-t pt-4">
                <div className="space-y-2 text-sm">
                  <div className="flex">
                    <span className="w-28 text-gray-600">국내 / 해외배송</span>
                    <span>{product?.shipping?.type}</span>
                  </div>
                  <div className="flex">
                    <span className="w-28 text-gray-600">배송방법</span>
                    <span>{product?.shipping?.method}</span>
                  </div>
                  <div className="flex">
                    <span className="w-28 text-gray-600">배송비</span>
                    <span>{product?.shipping?.cost}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-28 text-gray-600">
                      평균 재입고 소요일
                    </span>
                    <span>{product?.shipping?.averageRestockDays}일</span>
                    <HelpCircle className="ml-1 h-3 w-3 text-gray-400" />
                  </div>
                </div>
              </div>

              {/* Option Selection */}
              <div className="border-gray-20 mb-4 border-t pt-4">
                {product?.options && product.options.length > 0 ? (
                  <>
                    {/* 동적 옵션 렌더링 */}
                    {product?.options.map((option: any) => (
                      <div key={option.label} className="mb-4">
                        <div className="mb-4">
                          <span className="text-sm font-bold text-black">
                            옵션 : {option.label} 선택
                          </span>
                        </div>
                        <div
                          className={`flex gap-2 ${
                            option.values.length >= 7 ||
                            product?.options?.length >= 3
                              ? "overflow-x-auto pb-2"
                              : "flex-wrap"
                          }`}
                          style={{
                            scrollbarWidth: "none",
                            msOverflowStyle: "none",
                          }}
                        >
                          {option.values.map((value: any) => {
                            const isSelected =
                              selectedOptions[option.label] === value.name
                            const isDisabled = value.disabled || false

                            return (
                              <button
                                key={value.id}
                                onClick={() =>
                                  handleOptionChange(option.label, value.name)
                                }
                                disabled={isDisabled}
                                className={`flex-shrink-0 rounded-lg border px-4 py-2 text-left text-sm font-medium transition-colors ${
                                  isSelected
                                    ? "border-blue-500 bg-blue-500 text-white"
                                    : isDisabled
                                      ? "bg-muted0 cursor-not-allowed border-gray-200 text-gray-400"
                                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                                }`}
                              >
                                <div className="font-bold text-black">
                                  {value.name}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Selected Options */}
                    {selectedCartOptions.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {selectedCartOptions.map((option: any) => (
                          <div
                            key={option.id}
                            className="flex items-center gap-3 rounded-lg bg-white py-3"
                          >
                            <Image
                              className="h-20 w-20 rounded object-cover"
                              src={option.image || product?.thumbnails?.[0]}
                              alt={option.name}
                              width={80}
                              height={80}
                            />
                            <div className="flex-1">
                              <p className="text-sm font-medium">
                                {option.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                재고: {option.stock}개
                              </p>
                              <div className="mt-2 flex items-center gap-1">
                                <button
                                  onClick={() =>
                                    updateQuantity(
                                      option.id,
                                      option.quantity - 1
                                    )
                                  }
                                  className="flex h-8 w-8 items-center justify-center rounded border"
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <input
                                  type="text"
                                  value={option.quantity}
                                  readOnly
                                  className="h-8 w-12 rounded border text-center"
                                />
                                <button
                                  onClick={() =>
                                    updateQuantity(
                                      option.id,
                                      option.quantity + 1
                                    )
                                  }
                                  className="flex h-8 w-8 items-center justify-center rounded border"
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">
                                {(
                                  option.price * option.quantity
                                ).toLocaleString()}
                                원
                              </p>
                              <button
                                onClick={() => removeOption(option.id)}
                                className="mt-1"
                              >
                                <X className="h-4 w-4 text-gray-400" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <SingleOptionQuantitySelector
                    productName={product?.name || ""}
                    thumbnail={product?.thumbnails?.[0]}
                    quantity={quantity}
                    onQuantityChange={setQuantity}
                    price={getProductPrice()}
                    stock={0}
                    showTitle={true}
                  />
                )}
              </div>

              {/* Total Price */}
              <div className="border-gray-20 mb-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">총 상품 금액</span>
                  <div className="flex items-center gap-4 text-right">
                    <p className="text-sm text-gray-500">
                      총 수량 {getTotalQuantity()}개
                    </p>
                    <p className="text-xl font-bold">
                      {getTotalPrice().toLocaleString()}원
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {isOutOfStock() ? (
                  <>
                    <CustomButton
                      variant="secondary"
                      size="lg"
                      className="flex-1"
                    >
                      <Bell className="h-4 w-4" />
                      <span>재입고알림 신청하기</span>
                    </CustomButton>
                    <CustomButton
                      variant="primary"
                      size="lg"
                      className="flex-1 bg-green-600"
                    >
                      <Zap className="h-4 w-4" />
                      <span>미리구매하기</span>
                    </CustomButton>
                  </>
                ) : (
                  <>
                    <CustomButton
                      variant="outline"
                      size="lg"
                      className="flex-1"
                    >
                      장바구니
                    </CustomButton>
                    <CustomButton
                      variant="primary"
                      size="lg"
                      className="flex-1"
                      onClick={() => {
                        // 장바구니에 상품 추가 후 체크아웃 페이지로 이동
                        if (
                          selectedOptions &&
                          Object.keys(selectedOptions).length > 0
                        ) {
                          addOptionToCart()
                        }
                        window.location.href = `/${countryCode}/order/checkout`
                      }}
                    >
                      바로구매
                    </CustomButton>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Bar (Mobile) - 기본 상태 */}
      {!isBottomSheetOpen && (
        <div className="border-gray-20 fixed right-0 bottom-0 left-0 z-50 border-t bg-white p-4 md:hidden">
          <div className="flex gap-2">
            <CustomButton
              variant="secondary"
              size="lg"
              onClick={handleWishlistToggle}
              disabled={wishlistLoading}
            >
              <Heart
                className={`h-6 w-6 ${
                  isInWishlist(product?.id || "")
                    ? "fill-red-500 text-red-500"
                    : "text-gray-400"
                }`}
              />
            </CustomButton>
            <CustomButton variant="outline" size="lg" className="flex-1">
              장바구니
            </CustomButton>
            <CustomButton
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={() => {
                if (product?.options && product.options.length > 0) {
                  setIsBottomSheetOpen(true)
                } else {
                  // 옵션이 없는 경우 바로구매
                  addOptionToCart()
                  window.location.href = `/${countryCode}/order/checkout`
                }
              }}
            >
              바로구매
            </CustomButton>
          </div>
        </div>
      )}

      {/* Bottom Sheet */}
      {isBottomSheetOpen && (
        <div
          className="animate-slide-up fixed right-0 bottom-0 left-0 z-[70] rounded-t-2xl bg-white md:hidden"
          style={{
            boxShadow:
              "0 -4px 25px -5px rgba(0, 0, 0, 0.1), 0 -10px 10px -5px rgba(0, 0, 0, 0.04)",
          }}
        >
          {/* Sheet Header */}
          <div className="flex flex-col items-center justify-center">
            <button onClick={() => setIsBottomSheetOpen(false)} className="p-2">
              <ChevronDown className="h-7 w-7 text-gray-300" />
            </button>
          </div>

          {/* Sheet Content */}
          <div className="max-h-[60vh] overflow-y-auto p-4">
            {/* 옵션이 있는 경우 */}
            {product?.options && product.options.length > 0 ? (
              <div className="space-y-4">
                {product.options.map((option: any) => (
                  <div key={option.label} className="mb-4">
                    <div className="mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        {option.label} 선택
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {option.values.map((value: any) => {
                        const isSelected =
                          selectedOptions[option.label] === value.name
                        const isDisabled = value.disabled || false

                        return (
                          <button
                            key={value.id}
                            onClick={() =>
                              handleOptionChange(option.label, value.name)
                            }
                            disabled={isDisabled}
                            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                              isSelected
                                ? "border-blue-500 bg-blue-500 text-white"
                                : isDisabled
                                  ? "bg-muted0 cursor-not-allowed border-gray-200 text-gray-400"
                                  : "border-gray-300 bg-white text-gray-700 hover:border-blue-300"
                            }`}
                          >
                            {value.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {/* 선택된 옵션 표시 */}
                {selectedCartOptions.length > 0 && (
                  <div className="border-t pt-4">
                    {selectedCartOptions.map((option: any) => (
                      <div
                        key={option.id}
                        className="flex items-center gap-3 border-b py-3"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">{option.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              updateQuantity(option.id, option.quantity - 1)
                            }
                            className="flex h-7 w-7 items-center justify-center rounded border"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm">
                            {option.quantity}
                          </span>
                          <button
                            onClick={() =>
                              updateQuantity(option.id, option.quantity + 1)
                            }
                            className="flex h-7 w-7 items-center justify-center rounded border"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-sm font-medium">
                          {(option.price * option.quantity).toLocaleString()}원
                        </p>
                        <button onClick={() => removeOption(option.id)}>
                          <X className="h-4 w-4 text-gray-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // 옵션이 없는 경우 수량 선택
              <SingleOptionQuantitySelector
                productName={product?.name || ""}
                thumbnail={product?.thumbnails?.[0]}
                quantity={quantity}
                onQuantityChange={setQuantity}
                price={getProductPrice()}
                stock={0}
                className="py-4"
                showTitle={false}
              />
            )}

            {/* 성공 메시지 */}
            {showSuccessMessage && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-4">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500">
                  <Check className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800">
                    담기 완료
                  </p>
                  <p className="text-xs text-green-600">
                    {`멤버십 가격 ${getTotalPrice().toLocaleString()}원 할인받았어요`}
                  </p>
                </div>
                <button
                  onClick={() =>
                    (window.location.href = `/${countryCode}/cart`)
                  }
                  className="text-sm font-medium text-green-600"
                >
                  장바구니 바로가기
                </button>
              </div>
            )}
          </div>

          {/* Sheet Footer */}
          <div className="border-gray-20 border-t p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">구매수량 1개</span>
              <span className="text-lg font-bold">
                총 {getTotalPrice().toLocaleString()}원
              </span>
            </div>
            <div className="flex gap-2">
              {isOutOfStock() ? (
                <>
                  <CustomButton variant="outline" size="lg" className="flex-1">
                    <Bell className="h-4 w-4" />
                    <span>재입고알림 신청하기</span>
                  </CustomButton>
                  <CustomButton variant="primary" size="lg" className="flex-1">
                    <Zap className="h-4 w-4" />
                    <span>미리구매하기</span>
                  </CustomButton>
                </>
              ) : (
                <>
                  <CustomButton
                    variant="outline"
                    size="lg"
                    className="flex-1"
                    onClick={() => {
                      addOptionToCart()
                      window.location.href = `/${countryCode}/cart`
                    }}
                    disabled={
                      !isSingleOptionProduct() &&
                      selectedCartOptions.length === 0
                    }
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span>장바구니</span>
                  </CustomButton>
                  <CustomButton
                    variant="primary"
                    size="lg"
                    className="flex-1"
                    onClick={() => {
                      addOptionToCart()
                      window.location.href = `/${countryCode}/order/checkout`
                    }}
                    disabled={
                      !isSingleOptionProduct() &&
                      selectedCartOptions.length === 0
                    }
                  >
                    바로 구매
                  </CustomButton>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductDetailPage
