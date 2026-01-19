"use client"

import { useState } from "react"
import { SingleOptionQuantitySelector } from "@/app/[countryCode]/(main)/products/components/single-option-quantity-selector"
import { ProductPriceDisplay } from "./product-price-display"
import { ProductRatingDisplay } from "./product-rating-display"
import { ProductShippingInfo } from "./product-shipping-info"
import { ProductOptionSelector } from "./product-option-selector"
import type { ProductDetail } from "@lib/types/ui/product"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"

type Props = {
  product: ProductDetail
}

/**
 * @description 모바일 상품 정보 섹션
 * - 옵션 선택 로직을 내부에서 관리
 * - 액션은 이 컴포넌트에서 완결
 * - props drilling 최소화
 */
export function ProductInfoMobile({ product }: Props) {
  // 내부 상태 관리
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

  // 유틸 함수
  const isSingleOption = !product.options || product.options.length === 0
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
  const getPrice = () => getVariantPrice(defaultVariantId)
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    const member = product.membershipPrice || 0
    if (base > 0 && member > 0 && member < base) {
      return Math.round(((base - member) / base) * 100)
    }
    return 0
  }

  // 옵션 선택 핸들러
  const handleOptionChange = (optionLabel: string, value: string) => {
    const next = { ...selectedOptions, [optionLabel]: value }
    setSelectedOptions(next)

    const allSelected = (product.options ?? []).every((o) => !!next[o.label])
    if (!allSelected) return

    const optionName = (product.options ?? [])
      .map((o) => next[o.label])
      .join(" / ")

    const selectionKey = (product.options ?? [])
      .map((o) => `${o.label}=${next[o.label]}`)
      .join("|")
    const variantId = product.skuIndex?.[selectionKey]
    if (!variantId) return
    const optionPrice = getVariantPrice(variantId)

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
          variantId,
          name: optionName,
          quantity: 1,
          price: optionPrice,
          image:
            (variantId && product.variantThumbnailMap?.[variantId]) ||
            product.thumbnails?.[0] ||
            product.thumbnail ||
            "https://placehold.co/80x80?text=No+Image",
          stock:
            (variantId && product.skuStock?.[variantId]) || undefined,
        },
      ]
    })

    setSelectedOptions({})
  }

  const handleQuantityUpdate = (id: string, newQuantity: number) => {
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

  const handleOptionRemove = (id: string) => {
    setSelectedCartOptions(selectedCartOptions.filter((opt) => opt.id !== id))
  }

  return (
    <section className="md:hidden" aria-label="상품 정보">
      {/* 브랜드 & 상품명 */}
      <header className="mb-4">
        {product.brand && (
          <p className="text-sm text-gray-600">{product.brand}</p>
        )}
        <h2 className="text-xl font-bold">{product.name}</h2>
      </header>

      {/* 평점 - 선택 필드 */}
      {(product.rating || product.reviewCount) && (
        <ProductRatingDisplay
          rating={product.rating || 0}
          reviewCount={product.reviewCount || 0}
        />
      )}

      {/* 가격 - 필수 필드 */}
      <ProductPriceDisplay
        basePrice={product.basePrice || 0}
        membershipPrice={product.membershipPrice}
        isMembershipOnly={product.isMembershipOnly}
        discountRate={getDiscountRate()}
        memberPrices={product.memberPrices}
      />

      {/* 배송 정보 - 선택 필드 */}
      {product.shipping && <ProductShippingInfo shipping={product.shipping} />}

      {/* 수량/옵션 선택 */}
      {isSingleOption ? (
        <SingleOptionQuantitySelector
          productName={product.name}
          thumbnail={getThumbnailUrl(product.thumbnails?.[0] || "")}
          quantity={quantity}
          onQuantityChange={setQuantity}
          price={getPrice()}
          stock={0}
          className="mb-6"
          showTitle={true}
        />
      ) : (
        <ProductOptionSelector
          options={product.options || []}
          selectedOptions={selectedOptions}
          selectedCartOptions={selectedCartOptions}
          onOptionChange={handleOptionChange}
          onQuantityUpdate={handleQuantityUpdate}
          onOptionRemove={handleOptionRemove}
        />
      )}
    </section>
  )
}
