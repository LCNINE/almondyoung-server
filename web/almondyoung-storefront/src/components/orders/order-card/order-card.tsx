import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

interface OrderCardProps {
  /** 주문 ID */
  orderId: string
  /** 주문 날짜 (예: "6월 15일") */
  orderDate: string
  /** 주문번호 */
  orderNumber?: string
  /** 메인 콘텐츠 영역 */
  children: ReactNode
}

/**
 * 주문 카드 래퍼 컴포넌트
 * article과 header를 포함하며, children으로 메인 콘텐츠를 받습니다.
 */
export default function OrderCard({
  orderId,
  orderDate,
  orderNumber,
  children,
}: OrderCardProps) {
  return (
    <article className="rounded-none bg-white md:rounded-[10px] md:border md:border-gray-200 md:p-5">
      {/* 헤더 - container */}
      <header className="mb-1.5 flex items-start justify-between md:mb-5">
        <div>
          <h2 className="text-xs leading-4 font-bold text-black md:text-lg md:leading-normal">
            {orderDate} 주문
          </h2>
          {orderNumber && (
            <p className="mt-0.5 text-[11px] text-gray-500 md:mt-1 md:text-sm">
              주문번호 {orderNumber}
            </p>
          )}
        </div>
        {/* 데스크탑 전용 - 주문 상세보기 */}
        <Link
          href={`/mypage/order/details?orderId=${orderId}`}
          className="hidden items-center gap-2 text-base text-black md:flex"
        >
          주문 상세보기
          <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      {/* 메인 컨텐츠 영역 */}
      {children}
    </article>
  )
}
