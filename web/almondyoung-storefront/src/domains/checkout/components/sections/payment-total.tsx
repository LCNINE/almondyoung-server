"use client"

import { CheckoutMembershipTagIcon } from "@/icons/membership-tag-icon"
import type { CartTotals } from "@/lib/types/ui/cart"
import { convertToLocale } from "@/lib/utils/price-utils"

interface PaymentTotalSectionProps {
  totals: CartTotals
}

export const PaymentTotalSection = ({ totals }: PaymentTotalSectionProps) => {
  const {
    currency_code,
    original_item_subtotal,
    shipping,
    membershipDiscount,
    totalDiscount,
    finalTotal,
  } = totals

  const formatAmount = (amount: number) =>
    convertToLocale({ amount, currency_code, maximumFractionDigits: 0 })

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-gray-900 lg:text-xl">
        결제 정보
      </h2>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white lg:rounded-[10px]">
        <div className="space-y-3 p-4 lg:p-6">
          <InfoRow
            label="상품 금액"
            value={formatAmount(original_item_subtotal)}
            dataTestId="cart-subtotal"
            dataValue={original_item_subtotal}
          />

          <InfoRow
            label="배송비"
            value={formatAmount(shipping)}
            dataTestId="cart-shipping"
            dataValue={shipping}
          />

          {membershipDiscount > 0 && (
            <InfoRow
              label={
                <div className="flex items-center gap-1">
                  <CheckoutMembershipTagIcon />
                  <span className="text-[10px] font-medium text-[#E08F00] lg:text-xs">
                    멤버십 할인
                  </span>
                </div>
              }
              value={`- ${formatAmount(membershipDiscount)}`}
              dataTestId="cart-discount"
              dataValue={totalDiscount}
              isDiscount
            />
          )}

          {totalDiscount > 0 && (
            <InfoRow
              label={
                <span className="inline-flex items-baseline gap-1">
                  할인
                  <span className="text-[10px] font-normal text-gray-400 lg:text-[11px]">
                    (쿠폰·기타)
                  </span>
                </span>
              }
              value={`- ${formatAmount(totalDiscount)}`}
              dataTestId="cart-discount"
              dataValue={totalDiscount}
              isDiscount
            />
          )}
        </div>
        <div className="flex items-center justify-between bg-[#FFF7E5]/50 px-4 py-4 lg:px-6">
          <span className="text-sm font-semibold text-gray-900 lg:text-base">
            총 주문 금액
          </span>
          <span
            className="text-base font-bold text-[#F29219] lg:text-lg"
            data-testid="cart-total"
            data-value={finalTotal}
          >
            {formatAmount(finalTotal)}
          </span>
        </div>
      </div>
    </section>
  )
}

const InfoRow = ({
  label,
  value,
  dataTestId,
  dataValue,
  isDiscount,
}: {
  label: React.ReactNode
  value: string
  dataTestId?: string
  dataValue?: number
  isDiscount?: boolean
}) => (
  <div className="flex items-center justify-between">
    <span className="text-[12px] text-gray-900 lg:text-sm">{label}</span>
    <span
      className={`text-[13px] lg:text-sm ${isDiscount ? "text-[#F29219]" : "text-gray-900"}`}
      data-testid={dataTestId}
      data-value={dataValue ?? 0}
    >
      {value}
    </span>
  </div>
)
