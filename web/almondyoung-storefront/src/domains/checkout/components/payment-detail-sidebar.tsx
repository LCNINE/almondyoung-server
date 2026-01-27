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
  const formatAmount = (amount: number) =>
    convertToLocale({
      amount,
      currency_code: totals.currency_code,
      maximumFractionDigits: 0,
    })

  return (
    <section className="hidden lg:block lg:min-w-[320px] lg:flex-1 lg:w-[412px]">
      <div className="flex items-center justify-between">
        <h2 className="mb-3 text-xl font-bold text-gray-900">결제 상세</h2>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-[#F29219]">
            {formatAmount(totals.finalTotal)}
          </span>
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
            <div className="mb-10 flex items-center justify-between">
              <span className="text-lg font-bold text-gray-900">나중결제</span>
              <span className="text-lg font-bold text-gray-900">
                {formatAmount(totals.finalTotal)}
              </span>
            </div>
            <hr className="-mx-7 mb-4 border-gray-200" />
            <div className="space-y-2 text-base text-gray-900">
              <p>사용중: 150,000원 / 한도: 800,000원</p>
              <p>다음 결제일: 2024.02.25 (D-5)</p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
