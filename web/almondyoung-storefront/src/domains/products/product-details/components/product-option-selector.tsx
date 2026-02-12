"use client"

import { Button } from "@/components/ui/button"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { Minus, Plus, X } from "lucide-react"

type OptionValue = {
  id: string
  name: string
  disabled?: boolean
  isSoldOut?: boolean
}

type Option = {
  label: string
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

type Props = {
  options: Option[]
  selectedOptions: Record<string, string>
  selectedCartOptions: SelectedCartOption[]
  onOptionChange: (label: string, value: string) => void
  onQuantityUpdate: (id: string, newQuantity: number) => void
  onOptionRemove: (id: string) => void
}

/**
 * @description 상품 옵션 선택 컴포넌트
 * 시맨틱: <fieldset>과 <legend> 사용
 */
export function ProductOptionSelector({
  options,
  selectedOptions,
  selectedCartOptions,
  onOptionChange,
  onQuantityUpdate,
  onOptionRemove,
}: Props) {
  const hasMultipleOptions =
    options.length >= 3 || options.some((o) => o.values.length >= 7)

  return (
    <section className="space-y-4">
      {/* 옵션 선택 */}
      {options.map((option) => (
        <fieldset key={option.label} className="mb-4">
          <legend className="mb-2 text-sm font-medium text-gray-700 md:mb-4 md:text-sm md:font-bold md:text-black">
            {option.label} 선택
          </legend>

          <div
            className={`flex gap-2 ${
              hasMultipleOptions ? "overflow-x-auto pb-2" : "flex-wrap"
            }`}
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {option.values.map((value) => {
              const isSelected = selectedOptions[option.label] === value.name
              const isDisabled = value.disabled || false
              const isSoldOut = value.isSoldOut || false

              return (
                <Button
                  key={value.id}
                  type="button"
                  variant="outline"
                  onClick={() => onOptionChange(option.label, value.name)}
                  disabled={isDisabled}
                  // className="shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
                  // className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  //   isSelected
                  //     ? "border-blue-500 bg-blue-500 text-white"
                  //     : isDisabled || isSoldOut
                  //       ? "bg-gray-10 cursor-not-allowed border-gray-200 text-gray-400"
                  //       : "border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                  // }`}
                  aria-pressed={isSelected}
                >
                  {value.name}
                  {isSoldOut && (
                    <span className="ml-1 text-xs text-gray-400">(품절)</span>
                  )}
                </Button>
              )
            })}
          </div>
        </fieldset>
      ))}

      {/* 선택된 옵션 목록 */}
      {selectedCartOptions.length > 0 && (
        <ul className="mt-4 space-y-3">
          {selectedCartOptions.map((option) => (
            <OptionCartItem
              key={option.id}
              option={option}
              onQuantityUpdate={onQuantityUpdate}
              onRemove={onOptionRemove}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

// 선택된 옵션 카드 아이템
function OptionCartItem({
  option,
  onQuantityUpdate,
  onRemove,
}: {
  option: SelectedCartOption
  onQuantityUpdate: (id: string, newQuantity: number) => void
  onRemove: (id: string) => void
}) {
  // 재고가 0이면 품절 (Infinity는 무제한이므로 품절 아님)
  const isSoldOut =
    option.stock !== undefined && option.stock !== Infinity && option.stock <= 0

  return (
    <li className="flex items-center gap-3 rounded-lg bg-white py-3">
      <div className="relative">
        <img
          className={`h-20 w-20 shrink-0 rounded object-cover md:h-20 md:w-20 ${isSoldOut ? "opacity-50" : ""}`}
          src={getThumbnailUrl(option.image)}
          alt={option.name}
          width={80}
          height={80}
        />
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40">
            <span className="text-xs font-bold text-white">품절</span>
          </div>
        )}
      </div>

      <div className="flex-1 md:flex-1">
        <p
          className={`text-sm font-medium ${isSoldOut ? "text-gray-400" : ""}`}
        >
          {option.name}
        </p>
        {option.stock !== undefined && option.stock !== Infinity && (
          <p
            className={`text-xs ${isSoldOut ? "font-medium text-red-500" : "text-gray-500"}`}
          >
            {isSoldOut ? "품절" : `재고: ${option.stock}개`}
          </p>
        )}

        {/* 수량 조절 버튼 */}
        <div className="mt-2 flex items-center gap-1 md:mt-2">
          <button
            type="button"
            onClick={() => onQuantityUpdate(option.id, option.quantity - 1)}
            disabled={isSoldOut}
            className={`flex h-6 w-6 items-center justify-center rounded border md:h-8 md:w-8 ${isSoldOut ? "cursor-not-allowed opacity-50" : ""}`}
            aria-label="수량 감소"
          >
            <Minus className="h-3 w-3 md:h-4 md:w-4" />
          </button>
          <input
            type="text"
            value={option.quantity}
            readOnly
            className={`h-6 w-12 rounded border text-center text-sm md:h-8 ${isSoldOut ? "opacity-50" : ""}`}
            aria-label="수량"
          />
          <button
            type="button"
            onClick={() => onQuantityUpdate(option.id, option.quantity + 1)}
            disabled={isSoldOut}
            className={`flex h-6 w-6 items-center justify-center rounded border md:h-8 md:w-8 ${isSoldOut ? "cursor-not-allowed opacity-50" : ""}`}
            aria-label="수량 증가"
          >
            <Plus className="h-3 w-3 md:h-4 md:w-4" />
          </button>
        </div>
      </div>

      {/* 가격 및 삭제 버튼 */}
      <div className="text-right">
        <p
          className={`text-sm font-medium md:font-medium ${isSoldOut ? "text-gray-400" : ""}`}
        >
          {(option.price * option.quantity).toLocaleString()}원
        </p>
        <button
          type="button"
          onClick={() => onRemove(option.id)}
          className="mt-1"
          aria-label="옵션 삭제"
        >
          <X className="h-4 w-4 text-gray-400" />
        </button>
      </div>
    </li>
  )
}
