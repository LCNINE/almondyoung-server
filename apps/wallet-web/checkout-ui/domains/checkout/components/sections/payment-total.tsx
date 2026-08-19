"use client"

import { PriceRow } from "@/checkout-ui/domains/checkout/components/shared/price-row"
import { CheckoutMembershipTagIcon } from "@/checkout-ui/icons/membership-tag-icon"
import type { CartTotals } from "@/checkout-ui/lib/types/ui/cart"
import { convertToLocale } from "@/checkout-ui/lib/utils/price-utils"
import { useTranslations } from "next-intl"

interface PaymentTotalSectionProps {
  totals: CartTotals
}

export const PaymentTotalSection = ({ totals }: PaymentTotalSectionProps) => {
  const t = useTranslations("checkout.paymentTotal")
  const {
    currency_code,
    original_item_subtotal,
    shipping,
    shippingBreakdown,
    membershipDiscount,
    totalDiscount,
    finalTotal,
  } = totals

  const formatAmount = (amount: number) =>
    convertToLocale({ amount, currency_code, maximumFractionDigits: 0 })

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-gray-900 lg:text-xl">
        {t("title")}
      </h2>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white lg:rounded-[10px]">
        <div className="space-y-3 p-4 lg:p-6">
          <PriceRow>
            <PriceRow.Label size="sm">{t("itemAmount")}</PriceRow.Label>
            <PriceRow.Value
              className="text-[13px] lg:text-sm"
              data-testid="cart-subtotal"
              data-value={original_item_subtotal}
            >
              {formatAmount(original_item_subtotal)}
            </PriceRow.Value>
          </PriceRow>

          <PriceRow>
            <PriceRow.Label size="sm">{t("shipping")}</PriceRow.Label>
            <PriceRow.Value
              className="text-[13px] lg:text-sm"
              data-testid="cart-shipping"
              data-value={shipping}
            >
              {formatAmount(shipping)}
            </PriceRow.Value>
          </PriceRow>

          {(shippingBreakdown?.length ?? 0) > 1 &&
            shippingBreakdown!.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between pl-3 text-[11px] text-gray-400 lg:text-xs"
              >
                <span>{method.name}</span>
                <span>{formatAmount(method.amount)}</span>
              </div>
            ))}

          {membershipDiscount > 0 && (
            <PriceRow>
              <PriceRow.Label
                size="xs"
                tone="membership"
                weight="medium"
                className="flex items-center gap-1"
              >
                <CheckoutMembershipTagIcon />
                {t("membershipDiscount")}
              </PriceRow.Label>
              <PriceRow.Value
                tone="discount"
                className="text-[13px] lg:text-sm"
                data-testid="cart-discount"
                data-value={totalDiscount}
              >
                - {formatAmount(membershipDiscount)}
              </PriceRow.Value>
            </PriceRow>
          )}

          {totalDiscount > 0 && (
            <PriceRow>
              <PriceRow.Label
                size="sm"
                className="inline-flex items-baseline gap-1"
              >
                {t("discount")}
                <span className="text-[10px] font-normal text-gray-400 lg:text-[11px]">
                  {t("couponEtc")}
                </span>
              </PriceRow.Label>
              <PriceRow.Value
                tone="discount"
                className="text-[13px] lg:text-sm"
                data-testid="cart-discount"
                data-value={totalDiscount}
              >
                - {formatAmount(totalDiscount)}
              </PriceRow.Value>
            </PriceRow>
          )}
        </div>
        <PriceRow highlight="beige">
          <PriceRow.Label size="base" weight="semibold">
            {t("totalAmount")}
          </PriceRow.Label>
          <PriceRow.Value
            size="lg"
            weight="bold"
            tone="discount"
            data-testid="cart-total"
            data-value={finalTotal}
          >
            {formatAmount(finalTotal)}
          </PriceRow.Value>
        </PriceRow>
      </div>
    </section>
  )
}
