"use client"

import { MembershipTagIcon } from "@/icons/membership-tag-icon"
import { convertToLocale } from "@/lib/utils/price-utils"
import type { CartTotals } from "@/lib/types/ui/cart"

interface PaymentTotalSectionProps {
  totals: CartTotals
}

export const PaymentTotalSection = ({ totals }: PaymentTotalSectionProps) => {
  const {
    currency_code,
    item_subtotal,
    shippingFee,
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
            label="주문 상품"
            value={formatAmount(item_subtotal)}
            dataTestId="cart-subtotal"
            dataValue={item_subtotal}
          />
          <InfoRow
            label="배송비"
            value={formatAmount(shippingFee)}
            dataTestId="cart-shipping"
            dataValue={shippingFee}
          />
          {totalDiscount > 0 && (
            <InfoRow
              label={
                <span className="flex items-center gap-2">
                  할인 / 부가결제
                  {membershipDiscount > 0 && <MembershipTagIcon />}
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
