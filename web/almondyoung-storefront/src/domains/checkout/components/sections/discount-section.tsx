import { Input } from "@components/common/ui/input"
import { formatPrice } from "@lib/utils/format-price"
import { CheckoutMembershipTagIcon } from "@/icons/membership-tag-icon"
import { ChevronDown } from "lucide-react"

// 할인/부가결제 섹션
export const DiscountSection = () => (
  <section aria-labelledby="discount-heading" className="mb-8">
    <h2
      id="discount-heading"
      className="mb-3 text-base font-bold text-gray-900 md:text-xl"
    >
      할인 / 부가결제
    </h2>
    <div className="flex w-full flex-col gap-5 rounded-[10px] border border-[#d9d9d9] bg-white p-[15px] md:max-w-[810px] md:gap-8 md:p-[30px]">
      {/* 자동할인 */}
      <div className="flex flex-col justify-between md:flex-row md:items-center">
        <div className="flex flex-col gap-1.5 md:gap-2">
          <h3 className="text-xs font-bold text-black md:text-base">
            자동할인
          </h3>
          <div className="flex items-center gap-0.5">
            <CheckoutMembershipTagIcon />
            <span className="text-[10px] font-medium text-[#e08f00] md:text-sm">
              멤버십 할인
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-col items-end gap-0.5 md:mt-0">
          <span className="text-sm font-medium text-[#757575] line-through md:text-base">
            -21,000원
          </span>
          <span className="text-base font-bold text-black md:text-lg">
            -42,000원
          </span>
        </div>
      </div>

      <hr className="border-t border-[#d9d9d9]" />

      {/* 쿠폰 */}
      <div className="flex flex-col gap-3 md:gap-4">
        <label className="text-xs font-bold text-black md:text-base">
          쿠폰
        </label>
        <div className="relative w-full">
          <select className="w-full appearance-none rounded-[5px] border border-[#d9d9d9] bg-white px-2.5 py-[9px] text-[11px] text-black placeholder:text-[#b3b3b3] focus:border-black focus:outline-none md:px-4 md:py-3 md:text-sm">
            <option value="" disabled selected>
              쿠폰을 선택해주세요 (1)
            </option>
            <option value="coupon1">5% 할인 쿠폰</option>
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 text-black md:h-4 md:w-4" />
        </div>
      </div>

      <hr className="border-t border-[#d9d9d9]" />

      {/* 적립금 */}
      <div className="flex flex-col gap-3 md:gap-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-black md:text-base">
            적립금
          </label>
          <span className="text-xs text-black md:text-sm">
            보유: <span className="font-bold">9,000원</span>
          </span>
        </div>
        <div className="flex gap-2 md:gap-3">
          <div className="relative flex-1">
            <Input
              type="text"
              placeholder="0원"
              className="h-10 w-full rounded-[5px] border border-[#d9d9d9] px-3 py-2 text-right text-[13px] font-bold text-[#ffa500] placeholder-gray-300 focus:border-[#ffa500] focus:outline-none md:px-4 md:py-3 md:text-base"
              value={formatPrice(9000) + "원"}
            />
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-[#757575] md:text-sm">
              사용
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-[5px] bg-[#fff7e5] px-3 py-2 text-[11px] font-bold text-black transition-colors hover:bg-[#ffeeb3] md:px-5 md:py-3 md:text-sm"
          >
            전액사용
          </button>
        </div>
      </div>
    </div>
  </section>
)
