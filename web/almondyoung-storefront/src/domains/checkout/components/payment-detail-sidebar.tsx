import { CheckoutMembershipTagIcon } from "@/icons/membership-tag-icon"
import type { CartTotals } from "@/lib/types/ui/cart"
import { convertToLocale } from "@/lib/utils/price-utils"

// PC 결제 상세 사이드바
export const PaymentDetailSidebar = ({
  isOpen,
  setIsOpen,
  totals,
}: {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  totals: CartTotals
}) => {
  const {
    currency_code,
    original_item_subtotal,
    shipping,
    membershipDiscount,
    totalDiscount,
    finalTotal,
  } = totals

  const formatAmount = (amount: number) =>
    convertToLocale({
      amount,
      currency_code: currency_code,
      maximumFractionDigits: 0,
    })

  return (
    <section className="hidden lg:block lg:w-[412px] lg:min-w-[320px] lg:flex-1">
      <div className="flex items-center justify-between">
        <h2 className="mb-3 text-xl font-bold text-gray-900">결제 상세</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="hover:bg-muted rounded p-1"
          >
            <svg
              className={`h-6 w-6 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="rounded-[10px] border border-gray-200 bg-white">
          <div className="p-7">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-base text-gray-600">상품금액</span>
              <span className="text-base font-semibold text-gray-900">
                {formatAmount(original_item_subtotal)}
              </span>
            </div>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-base text-gray-600">배송비</span>
              <span className="text-base font-semibold text-gray-900">
                {shipping > 0 ? formatAmount(shipping) : "무료"}
              </span>
            </div>

            {membershipDiscount > 0 && (
              <div className="mb-4 flex items-center justify-between">
                <span className="text-base text-gray-600">멤버십 할인</span>
                <span className="text-base font-semibold text-gray-900">
                  {`-${formatAmount(membershipDiscount)}`}
                </span>
              </div>
            )}

            {totals.totalDiscount > 0 && (
              <div className="mb-4 flex items-center justify-between">
                <span className="text-base text-gray-600">할인</span>
                <span className="text-base font-semibold text-gray-900">
                  {`-${formatAmount(totalDiscount)}`}
                </span>
              </div>
            )}
            <hr className="-mx-7 my-4 border-gray-200" />
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-gray-900">
                총 결제금액
              </span>
              <span className="text-lg font-bold text-[#F29219]">
                {formatAmount(finalTotal)}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
