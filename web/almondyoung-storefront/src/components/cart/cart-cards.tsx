"use client"

import React from "react"
// 사용하는 풀네임 컴포넌트들을 import 합니다. 실제 경로에 맞게 수정해주세요.
import {
  CartCardRoot,
  CartCardThumbnail,
  CartCardContent,
  CartCardTitle,
  CartCardOption,
  CartCardBrand,
  CartCardBadge,
  CartCardPrice,
  CartCardPCRoot,
  CartCardPCThumbnail,
  CartCardPCTitle,
  CartCardPCOption,
  CartCardPCBadge,
  CartCardPCPrice,
  CartCardPCContent,
  CartCardPCInfo,
  CartCardPCImageSection,
  CartCardPCHeader,
} from "./cart-card.atomic"
import { CustomCheckbox } from "../shared/checkbox"
import { X } from "lucide-react"
import { Button } from "../ui/button"
import Link from "next/link"

// 수량 조절 컴포넌트
const QuantityControl = ({
  quantity = 1,
  onQuantityChange,
  maxQuantity,
}: {
  quantity?: number
  onQuantityChange?: (quantity: number) => void
  maxQuantity?: number
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleDecrease = () => {
    if (onQuantityChange && quantity > 1) {
      onQuantityChange(quantity - 1)
    }
  }

  const handleIncrease = () => {
    if (maxQuantity !== undefined && quantity >= maxQuantity) return
    if (onQuantityChange) {
      onQuantityChange(quantity + 1)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === "") {
      return
    }
    const val = parseInt(raw, 10)
    if (!isNaN(val) && onQuantityChange) {
      onQuantityChange(val)
    }
  }

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (isNaN(val) || val < 1) {
      if (onQuantityChange) {
        onQuantityChange(1)
      }
    }
  }

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select()
  }

  const handleDirectInputClick = () => {
    inputRef.current?.focus()
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex w-fit items-center overflow-hidden rounded border border-gray-300 text-sm">
        <Button
          variant="ghost"
          onClick={handleDecrease}
          disabled={quantity <= 1}
          size="icon"
          className="h-8 w-8 rounded-none sm:h-9 sm:w-9"
        >
          -
        </Button>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={quantity}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={handleInputFocus}
          className="w-10 border-x border-gray-300 bg-white px-2 py-1 text-center font-bold outline-none sm:w-12 sm:px-4"
        />
        <Button
          variant="ghost"
          onClick={handleIncrease}
          disabled={maxQuantity !== undefined && quantity >= maxQuantity}
          size="icon"
          className="h-8 w-8 rounded-none sm:h-9 sm:w-9"
        >
          +
        </Button>
      </div>
      <Button
        variant="outline"
        onClick={handleDirectInputClick}
        className="hidden h-8 px-3 text-xs text-gray-600 sm:inline-flex"
      >
        직접입력
      </Button>
    </div>
  )
}

interface CartCardProps {
  checked?: boolean
  onCheckChange?: (checked: boolean) => void
  onDelete?: () => void
  thumbnail: string
  title: string
  option?: string
  brand?: string
  badge?: string
  originalPrice?: number
  discountedPrice: number
  actualPrice?: number
  discountRate?: number
  isMembership?: boolean
  showMembershipHint?: boolean
  quantity?: number
  onQuantityChange?: (quantity: number) => void
  productId?: string
  productHandle?: string
  countryCode?: string
  manageInventory?: boolean
  inventoryQuantity?: number
  isWelcomeMembership?: boolean
}

/**
 * 반응형 장바구니 카드 컴포넌트 (모바일 + PC)
 */
export const CartCard = ({
  checked = true,
  onCheckChange,
  onDelete,
  thumbnail,
  title,
  option,
  brand,
  badge,
  originalPrice,
  discountedPrice,
  actualPrice,
  discountRate,
  isMembership = false,
  showMembershipHint = false,
  quantity = 1,
  onQuantityChange,
  productHandle,
  countryCode = "kr",
  manageInventory = false,
  inventoryQuantity = 0,
  isWelcomeMembership = false,
}: CartCardProps) => {
  const productLink = productHandle
    ? `/${countryCode}/products/${productHandle}`
    : undefined

  // 품절 여부 확인
  const isSoldOut = manageInventory && inventoryQuantity <= 0
  // 재고 부족 여부 (10개 이하)
  const isLowStock =
    manageInventory && inventoryQuantity > 0 && inventoryQuantity <= 10

  return (
    <>
      {/* 모바일 버전 (768px 미만) */}
      <div className="block lg:hidden">
        <CartCardRoot
          controlLeft={
            <CustomCheckbox
              checked={checked}
              id="cart-card-checkbox-mobile"
              name="cart-card-checkbox"
              value="1"
              onCheckedChange={(checked) => onCheckChange?.(checked as boolean)}
              disabled={isSoldOut}
            />
          }
          controlRight={
            <Button
              variant="ghost"
              name="삭제"
              aria-label="삭제"
              onClick={onDelete}
              className="p-1"
            >
              <X className="h-5 w-5" />
            </Button>
          }
        >
          <div className="relative flex gap-4">
            {/* 품절 오버레이 */}
            {isSoldOut && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/80">
                <div className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white">
                  품절된 상품
                </div>
              </div>
            )}

            {productLink ? (
              <Link href={productLink} className="shrink-0">
                <CartCardThumbnail src={thumbnail} />
              </Link>
            ) : (
              <CartCardThumbnail src={thumbnail} />
            )}
            <CartCardContent>
              {productLink ? (
                <Link href={productLink} className="hover:text-blue-600">
                  <CartCardTitle>{title}</CartCardTitle>
                </Link>
              ) : (
                <CartCardTitle>{title}</CartCardTitle>
              )}
              {option && <CartCardOption>{option}</CartCardOption>}
              {brand && <CartCardBrand>{brand}</CartCardBrand>}
              {badge && !isSoldOut && <CartCardBadge>{badge}</CartCardBadge>}

              {/* 재고 부족 경고 */}
              {isLowStock && (
                <div className="mt-1 text-xs text-orange-600">
                  재고 {inventoryQuantity}개 남음
                </div>
              )}

              <CartCardPrice
                original={originalPrice || 0}
                discounted={discountedPrice}
                discountRate={discountRate || 0}
                membership={isMembership}
                actual={actualPrice}
                showMembershipHint={showMembershipHint}
              />
              <div className="mt-2">
                <QuantityControl
                  quantity={quantity}
                  onQuantityChange={onQuantityChange}
                  maxQuantity={isWelcomeMembership ? 1 : undefined}
                />
              </div>
            </CartCardContent>
          </div>
        </CartCardRoot>
      </div>

      {/* PC 버전 (1024px 이상) */}
      <div className="hidden px-4 lg:block">
        <CartCardPCRoot>
          <CartCardPCHeader>
            {/* 체크박스 + 상품 정보 영역 */}
            <div className="flex flex-1 items-start gap-4">
              <CustomCheckbox
                checked={checked}
                id="cart-card-checkbox-pc"
                name="cart-card-checkbox"
                value="1"
                onCheckedChange={(checked) =>
                  onCheckChange?.(checked as boolean)
                }
                className="mt-1"
                disabled={isSoldOut}
              />

              {/* 상품명과 옵션 */}
              <CartCardPCInfo>
                {productLink ? (
                  <Link href={productLink} className="hover:text-blue-600">
                    <CartCardPCTitle>{title}</CartCardPCTitle>
                  </Link>
                ) : (
                  <CartCardPCTitle>{title}</CartCardPCTitle>
                )}
                {option && <CartCardPCOption>{option}</CartCardPCOption>}
              </CartCardPCInfo>
            </div>

            {/* 삭제 버튼 */}
            <Button
              variant="ghost"
              name="삭제"
              aria-label="삭제"
              onClick={onDelete}
              className="rounded p-1"
            >
              <X className="h-5 w-5" />
            </Button>
          </CartCardPCHeader>

          {/* 이미지와 가격/수량 정보 영역 */}
          <CartCardPCImageSection>
            <div className="relative shrink-0">
              {/* 품절 오버레이 */}
              {isSoldOut && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/80">
                  <div className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white">
                    품절
                  </div>
                </div>
              )}

              {productLink ? (
                <Link href={productLink}>
                  <CartCardPCThumbnail src={thumbnail} alt={title} />
                </Link>
              ) : (
                <CartCardPCThumbnail src={thumbnail} alt={title} />
              )}
            </div>

            <CartCardPCContent>
              {badge && !isSoldOut && (
                <CartCardPCBadge>{badge}</CartCardPCBadge>
              )}

              {/* 재고 부족 경고 */}
              {isLowStock && (
                <div className="text-sm text-orange-600">
                  재고 {inventoryQuantity}개 남음
                </div>
              )}

              <CartCardPCPrice
                original={originalPrice}
                discounted={discountedPrice}
                discountRate={discountRate}
                isMembership={isMembership}
                actual={actualPrice}
                showMembershipHint={showMembershipHint}
              />
              <QuantityControl
                quantity={quantity}
                onQuantityChange={onQuantityChange}
              />
            </CartCardPCContent>
          </CartCardPCImageSection>
        </CartCardPCRoot>
      </div>
    </>
  )
}

/**
 * 스토리북용 예제 컴포넌트
 */
export const BasicCartCard = () => {
  return (
    <CartCard
      checked
      thumbnail="https://almondyoung.com/web/product/medium/202508/022cad97afedaf4594776ef6bbc71760.jpg"
      title="[동성제약] 헤어콘 프로틴 무향료 칼라크림 100g..."
      option="4 자연갈색"
      brand="동성제약"
      badge="4시 이전 주문 시 당일 출고 보장"
      originalPrice={30000}
      discountedPrice={9000}
      discountRate={78}
      isMembership={true}
      quantity={2}
      onCheckChange={(checked) => console.log("Checked:", checked)}
      onDelete={() => console.log("Delete clicked")}
      onQuantityChange={(qty) => console.log("Quantity:", qty)}
    />
  )
}

/**
 * PC 버전 할인 상품 예제
 */
export const PCDiscountExample = () => {
  return (
    <div className="bg-gray-50 p-4">
      <CartCard
        checked
        thumbnail="https://almondyoung.com/web/product/medium/202508/022cad97afedaf4594776ef6bbc71760.jpg"
        title="[동성제약] 헤어론 프로텐 무향료 칼라크림 1제120g+2제120g"
        option="4 자연갈색"
        badge="4시 이전 주문 시 당일 출고 보장"
        originalPrice={30000}
        discountedPrice={9000}
        discountRate={78}
        isMembership={true}
        quantity={1}
      />
    </div>
  )
}

/**
 * PC 버전 일반 상품 예제
 */
export const PCBasicExample = () => {
  return (
    <div className="bg-gray-50 p-4">
      <CartCard
        checked
        thumbnail="https://almondyoung.com/web/product/medium/202508/022cad97afedaf4594776ef6bbc71760.jpg"
        title="[동성제약] 헤어론 프로텐 무향료 칼라크림 1제120g+2제120g"
        option="4 자연갈색"
        badge="4시 이전 주문 시 당일 출고 보장"
        discountedPrice={9000}
        quantity={1}
      />
    </div>
  )
}
