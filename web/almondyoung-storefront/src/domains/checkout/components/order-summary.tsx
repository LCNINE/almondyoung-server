import { CheckoutMembershipTagIcon } from "@/icons/membership-tag-icon"
import { CartTotals } from "@/lib/types/ui/cart"
import { convertToLocale } from "@/lib/utils/price-utils"

interface MobileOrderSummaryProps {
  totals: CartTotals
  isMembership: boolean
}

// 모바일 주문 요약
export const MobileOrderSummary = ({
  totals,
  isMembership,
}: MobileOrderSummaryProps) => {
  const {
    currency_code,
    item_subtotal,
    shipping,
    membershipDiscount,
    totalDiscount,
    finalTotal,
  } = totals

  const hasMembershipDiscount = isMembership && membershipDiscount > 0
  const hasDiscount = totalDiscount > 0

  return (
    <section aria-labelledby="order-summary-heading" className="mb-6 lg:hidden">
      <h2
        id="order-summary-heading"
        className="mb-4 text-lg font-bold text-gray-800"
      >
        주문 요약
      </h2>
      <div className="overflow-hidden rounded-lg bg-white">
        <dl>
          {/* 주문 상품 */}
          <div className="flex justify-between px-5 py-4">
            <dt className="text-sm text-gray-600">주문 상품</dt>
            <dd className="text-sm font-semibold text-gray-800">
              {convertToLocale({ amount: item_subtotal, currency_code })}
            </dd>
          </div>

          {/* 배송비 */}
          <div className="flex justify-between px-5 py-4">
            <dt className="text-sm text-gray-600">배송비</dt>
            <dd className="text-sm font-semibold text-gray-800">
              {shipping > 0
                ? convertToLocale({ amount: shipping, currency_code })
                : "무료"}
            </dd>
          </div>

          {/* 할인 / 부가결제 */}
          <div className="flex items-center justify-between px-5 py-4">
            <dt className="flex items-center gap-1.5 text-sm text-gray-600">
              할인 / 부가결제
              {hasMembershipDiscount && (
                <span className="inline-flex items-center gap-0.5 rounded-sm bg-[#FFF8F2] px-1.5 py-0.5 text-[11px] font-bold text-[#F79A3A]">
                  <CheckoutMembershipTagIcon />
                  멤버십
                </span>
              )}
            </dt>
            <dd className="text-sm font-semibold text-gray-800">
              {hasDiscount
                ? `-${convertToLocale({ amount: totalDiscount, currency_code })}`
                : convertToLocale({ amount: 0, currency_code })}
            </dd>
          </div>
        </dl>

        {/* 총 주문 금액 */}
        <div className="flex items-center justify-between bg-[#FFFBF2] px-5 py-4">
          <p className="text-base font-bold text-gray-800">총 주문 금액</p>
          <p className="text-xl font-extrabold text-[#F77F00]">
            {convertToLocale({ amount: finalTotal, currency_code })}
          </p>
        </div>
      </div>
    </section>
  )
}
