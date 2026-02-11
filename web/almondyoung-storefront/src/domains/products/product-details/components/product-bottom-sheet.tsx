"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { SingleOptionQuantitySelector } from "@/app/[countryCode]/(main)/products/components/single-option-quantity-selector"
import { Check, ChevronDown, ShoppingCart } from "lucide-react"
import { ProductOptionSelector } from "./product-option-selector"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"

type OptionValue = {
  id: string
  name: string
  isSoldOut?: boolean
}

type ProductOption = {
  label: string
  type?: string
  values: OptionValue[]
}

type SelectedCartOption = {
  id: string
  variantId?: string
  name: string
  quantity: number
  price: number
  image: string
  stock?: number
}

type Product = {
  name: string
  thumbnails?: string[]
  options?: ProductOption[]
}

type Props = {
  isOpen: boolean
  product: Product
  quantity: number
  onQuantityChange: (quantity: number) => void
  getProductPrice: () => number
  getTotalPrice: () => number
  isSingleOptionProduct: boolean
  isOutOfStock: boolean
  showSuccessMessage: boolean
  onClose: () => void
  onAddToCart: () => void
  onBuyNow: () => void
  onGoToCart: () => void
  // 옵션 관련
  selectedOptions: Record<string, string>
  selectedCartOptions: SelectedCartOption[]
  onOptionChange: (label: string, value: string) => void
  onQuantityUpdate: (id: string, newQuantity: number) => void
  onOptionRemove: (id: string) => void
  optionsWithSoldOut?: ProductOption[]
  isSoldOut?: boolean
}

/**
 * @description 모바일 하단 바텀 시트
 * 시맨틱: <dialog> 역할의 시트 (role="dialog")
 */
export function ProductBottomSheet({
  isOpen,
  product,
  quantity,
  onQuantityChange,
  getProductPrice,
  getTotalPrice,
  isSingleOptionProduct,
  isOutOfStock,
  showSuccessMessage,
  onClose,
  onAddToCart,
  onBuyNow,
  onGoToCart,
  selectedOptions,
  selectedCartOptions,
  onOptionChange,
  onQuantityUpdate,
  onOptionRemove,
  optionsWithSoldOut,
  isSoldOut = false,
}: Props) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="상품 옵션 선택"
      className="animate-slide-up fixed right-0 bottom-0 left-0 z-[70] rounded-t-2xl bg-white md:hidden"
      style={{
        boxShadow:
          "0 -4px 25px -5px rgba(0, 0, 0, 0.1), 0 -10px 10px -5px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* 헤더 */}
      <header className="flex flex-col items-center justify-center">
        <button onClick={onClose} className="p-2" aria-label="시트 닫기">
          <ChevronDown className="h-7 w-7 text-gray-300" />
        </button>
      </header>

      {/* 콘텐츠 (단일 옵션 품절 시 숨김) */}
      <div className="max-h-[60vh] overflow-y-auto p-4">
        {product.options && product.options.length > 0 ? (
          <ProductOptionSelector
            options={optionsWithSoldOut || product.options}
            selectedOptions={selectedOptions}
            selectedCartOptions={selectedCartOptions}
            onOptionChange={onOptionChange}
            onQuantityUpdate={onQuantityUpdate}
            onOptionRemove={onOptionRemove}
          />
        ) : isSingleOptionProduct && isSoldOut ? null : (
          <SingleOptionQuantitySelector
            productName={product.name}
            thumbnail={getThumbnailUrl(product.thumbnails?.[0] || "")}
            quantity={quantity}
            onQuantityChange={onQuantityChange}
            price={getProductPrice()}
            stock={0}
            className="py-4"
            showTitle={false}
          />
        )}

        {/* 성공 메시지 */}
        {showSuccessMessage && (
          <aside
            className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500">
              <Check className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">담기 완료</p>
              <p className="text-xs text-green-600">
                멤버십 가격 {getTotalPrice().toLocaleString()}원 할인받았어요
              </p>
            </div>
            <button
              onClick={onGoToCart}
              className="text-sm font-medium text-green-600"
            >
              장바구니 바로가기
            </button>
          </aside>
        )}
      </div>

      {/* 푸터 */}
      <footer className="border-gray-20 border-t p-4">
        {/* 총 상품 금액 (단일 옵션 품절 시 숨김) */}
        {!(isSingleOptionProduct && isSoldOut) && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-gray-600">구매수량 1개</span>
            <output className="text-lg font-bold">
              총 {getTotalPrice().toLocaleString()}원
            </output>
          </div>
        )}

        <div className="flex gap-2">
          {isOutOfStock || (isSingleOptionProduct && isSoldOut) ? (
            <>
              {/* todo: 미연결 액션 임시 비활성화 */}
              {/* <CustomButton variant="outline" size="lg" className="flex-1">
                <Bell className="h-4 w-4" />
                <span>재입고알림 신청하기</span>
              </CustomButton>
              <CustomButton variant="fill" size="lg" className="flex-1">
                <Zap className="h-4 w-4" />
                <span>미리구매하기</span>
              </CustomButton> */}
              <CustomButton
                variant="outline"
                size="lg"
                className="flex-1 cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                disabled
              >
                현재 품절된 상품이에요
              </CustomButton>
            </>
          ) : (
            <>
              <CustomButton
                variant="outline"
                size="lg"
                className="flex-1"
                onClick={onAddToCart}
                disabled={
                  !isSingleOptionProduct && selectedCartOptions.length === 0
                }
              >
                <ShoppingCart className="h-4 w-4" />
                <span>장바구니 담기</span>
              </CustomButton>
              <CustomButton
                variant="fill"
                size="lg"
                className="flex-1"
                onClick={onBuyNow}
                disabled={
                  !isSingleOptionProduct && selectedCartOptions.length === 0
                }
              >
                바로 구매
              </CustomButton>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
