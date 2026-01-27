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

// 수량 조절 컴포넌트
const QuantityControl = ({
  quantity = 1,
  onQuantityChange,
}: {
  quantity?: number
  onQuantityChange?: (quantity: number) => void
}) => {
  const handleDecrease = () => {
    if (onQuantityChange && quantity > 1) {
      onQuantityChange(quantity - 1)
    }
  }

  const handleIncrease = () => {
    if (onQuantityChange) {
      onQuantityChange(quantity + 1)
    }
  }

  return (
    <div className="flex w-fit items-center overflow-hidden rounded border border-gray-300 text-sm">
      <button
        className="px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleDecrease}
        disabled={quantity <= 1}
      >
        -
      </button>
      <span className="border-x border-gray-300 bg-white px-4 py-1 font-bold">
        {quantity}
      </span>
      <button className="px-3 py-1 hover:bg-gray-50" onClick={handleIncrease}>
        +
      </button>
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
}: CartCardProps) => {
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
            />
          }
          controlRight={
            <button
              name="삭제"
              aria-label="삭제"
              onClick={onDelete}
              className="p-1"
            >
              <X className="h-5 w-5" />
            </button>
          }
        >
          <div className="flex gap-4">
            <CartCardThumbnail src={thumbnail} />
            <CartCardContent>
              <CartCardTitle>{title}</CartCardTitle>
              {option && <CartCardOption>{option}</CartCardOption>}
              {brand && <CartCardBrand>{brand}</CartCardBrand>}
              {badge && <CartCardBadge>{badge}</CartCardBadge>}
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
              />

              {/* 상품명과 옵션 */}
              <CartCardPCInfo>
                <CartCardPCTitle>{title}</CartCardPCTitle>
                {option && <CartCardPCOption>{option}</CartCardPCOption>}
              </CartCardPCInfo>
            </div>

            {/* 삭제 버튼 */}
            <button
              name="삭제"
              aria-label="삭제"
              onClick={onDelete}
              className="rounded p-1 hover:bg-gray-50"
            >
              <X className="h-5 w-5" />
            </button>
          </CartCardPCHeader>

          {/* 이미지와 가격/수량 정보 영역 */}
          <CartCardPCImageSection>
            <CartCardPCThumbnail src={thumbnail} alt={title} />
            <CartCardPCContent>
              {badge && <CartCardPCBadge>{badge}</CartCardPCBadge>}
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
