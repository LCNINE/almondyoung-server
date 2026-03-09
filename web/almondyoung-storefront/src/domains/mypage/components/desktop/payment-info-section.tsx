import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { BillingInfo } from "../../types/mypage-types"

interface PaymentInfoSectionProps {
  initialBillingInfo: BillingInfo | null
}

export function PaymentInfoSection({
  initialBillingInfo,
}: PaymentInfoSectionProps) {
  if (!initialBillingInfo) {
    return null
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`
  }

  return (
    <Link href="/kr/mypage/membership">
      <section className="self-stretch bg-white transition-opacity hover:opacity-80">
        <div className="flex flex-col items-center justify-center gap-4 py-6 pl-7">
          <h2 className="text-Labels-Primary text-lg font-bold">
            이번달 결제 금액
          </h2>

          <>
            {initialBillingInfo.nextBillingDate && (
              <p className="text-sm font-normal text-black">
                {formatDate(initialBillingInfo.nextBillingDate)} 결제 예정
              </p>
            )}

            <p className="inline-flex items-center justify-center gap-1">
              <span className="text-lg font-bold text-black">
                {initialBillingInfo.nextBillingAmount.toLocaleString()}
              </span>
              <span className="text-sm font-normal text-black">원</span>

              <ChevronRight className="h-5 w-5 text-black" />
            </p>
          </>

          {initialBillingInfo.periodStart && initialBillingInfo.periodEnd && (
            <dl className="bg-gray-background inline-flex items-start justify-start gap-7 rounded-[5px] px-3.5 py-1.5">
              <dt className="text-sm font-normal text-black">이용기간</dt>
              <dd className="text-sm font-normal text-black">
                {formatDate(initialBillingInfo.periodStart)} ~{" "}
                {formatDate(initialBillingInfo.periodEnd)}
              </dd>
            </dl>
          )}
        </div>
      </section>
    </Link>
  )
}
