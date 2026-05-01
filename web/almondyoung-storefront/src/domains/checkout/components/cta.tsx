import { Button } from "@/components/ui/button"
import { CartTotals } from "@/lib/types/ui/cart"
import { formatPrice } from "@/lib/utils/price-utils"

export const MobileCTA = ({
  onPayment,
  loading,
  disabled,
}: {
  onPayment: () => void
  loading: boolean
  disabled?: boolean
}) => (
  <footer className="mt-6 px-4 pb-6 lg:hidden">
    <p className="mb-2 text-center text-[11px] text-gray-600">
      주문 내용을 확인하였으며, 정보 제공에 동의합니다.
    </p>
    <button
      onClick={onPayment}
      disabled={loading || disabled}
      className="w-full rounded bg-[#ff9f00] py-3 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "처리 중..." : "결제하기"}
    </button>
  </footer>
)

// PC 하단 고정 CTA
export const PCFixedCTA = ({
  onPayment,
  loading,
  totals,
  disabled,
}: {
  onPayment: () => void
  loading: boolean
  totals: CartTotals
  disabled?: boolean
}) => (
  <div className="fixed right-0 bottom-0 left-0 hidden bg-white shadow-[0px_-6px_18px_-2px_rgba(0,0,0,0.25)] lg:block">
    <div className="container mx-auto max-w-[1360px] px-[40px] py-4">
      <div className="flex items-center justify-between">
        <p className="text-base text-gray-600">
          약관 및 주문 내용을 확인하였으며, 정보 제공 등에 동의합니다.
        </p>
        <Button
          onClick={onPayment}
          disabled={loading || disabled}
          size="lg"
          color="primary"
          className="min-w-[403px] cursor-pointer rounded-[5px] bg-[#F29219] px-4 py-[14px] text-[19px] font-bold text-white hover:bg-[#F29219]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "처리 중..."
            : `${formatPrice(totals.finalTotal)}원 결제하기`}
        </Button>
      </div>
    </div>
  </div>
)
