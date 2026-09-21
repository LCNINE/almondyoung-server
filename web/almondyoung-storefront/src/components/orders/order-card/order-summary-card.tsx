"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { useTranslations } from "next-intl"
import { useState, type ReactNode } from "react"
import OrderCard from "./order-card"
import OrderItemCartButton from "./order-item-cart-button"

function statusColor(label: string): string {
  if (label.includes("배송"))
    return label.includes("완료") ? "text-green-600" : "text-primary"
  return "text-gray-900"
}

const COLLAPSED_ITEM_COUNT = 3

export interface OrderSummaryItem {
  id: string
  title: string
  thumbnail: string
  href?: string
  price: string
  options?: string[]
  variantId?: string
  isDigital?: boolean
  reviewHref?: string
}

interface OrderSummaryCardProps {
  orderId: string
  orderDate: string
  orderNumber?: string
  status: string
  /** 도착 예정일 등. 물류 API 연동 전까지는 대개 빈 값 */
  deliveryInfo?: string
  items: OrderSummaryItem[]
  totalPrice?: string
  /** 포인트 사용 등으로 실결제액이 주문금액보다 적을 때의 주문금액. 취소선으로 앞에 붙는다. */
  originalPrice?: string
  children?: ReactNode
}

function ItemLink({
  href,
  className,
  children,
}: {
  href?: string
  className?: string
  children: ReactNode
}) {
  if (!href) return <div className={className}>{children}</div>
  return (
    <LocalizedClientLink href={href} className={className}>
      {children}
    </LocalizedClientLink>
  )
}

/**
 * 주문/배송 요약 카드
 */
export default function OrderSummaryCard({
  orderId,
  orderDate,
  orderNumber,
  status,
  deliveryInfo,
  items,
  totalPrice,
  originalPrice,
  children,
}: OrderSummaryCardProps) {
  const t = useTranslations("mypage.order")
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_ITEM_COUNT)
  const hiddenCount = items.length - visibleItems.length

  return (
    <OrderCard
      orderId={orderId}
      orderDate={orderDate}
      orderNumber={orderNumber}
    >
      <ul className="group/items flex flex-col gap-3">
        {visibleItems.map((item, index) => {
          const orderActions = index === 0 ? children : null

          return (
            <li
              key={item.id}
              className="flex flex-col rounded-lg border border-gray-200 md:flex-row"
            >
              <div className="min-w-0 flex-1 p-4 md:p-5">
                <p className="mb-3 text-base font-bold md:text-lg">
                  <span className={statusColor(status)}>{status}</span>
                  {deliveryInfo && (
                    <span className="text-gray-500"> · {deliveryInfo}</span>
                  )}
                </p>
                <div className="flex items-center gap-3.5">
                  <ItemLink href={item.href} className="shrink-0">
                    <img
                      className="h-20 w-20 rounded-md border border-[#ececec] object-cover"
                      src={getThumbnailUrl(item.thumbnail)}
                      alt={item.title}
                    />
                  </ItemLink>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <ItemLink href={item.href} className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium text-black md:text-base">
                        {item.title}
                      </p>
                    </ItemLink>
                    <div className="flex items-end justify-between gap-2">
                      <div className="text-xs text-gray-500 md:text-sm">
                        <p>{item.price}</p>
                        {item.options?.map((option, i) => (
                          <p key={i}>- {option}</p>
                        ))}
                      </div>
                      {item.isDigital ? (
                        <LocalizedClientLink href="/mypage/download">
                          <CustomButton
                            variant="outline"
                            color="secondary"
                            size="sm"
                          >
                            {t("actions.download")}
                          </CustomButton>
                        </LocalizedClientLink>
                      ) : (
                        item.variantId && (
                          <OrderItemCartButton variantId={item.variantId} />
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {(orderActions || item.reviewHref) && (
                <div
                  className={cn(
                    "flex shrink-0 flex-col gap-2 border-t border-gray-200 p-4 md:w-48 md:border-t-0 md:border-l md:p-5",
                    !item.reviewHref &&
                      "md:hidden md:has-[[data-order-actions]]:flex"
                  )}
                >
                  {orderActions}
                  {item.reviewHref && (
                    <LocalizedClientLink href={item.reviewHref}>
                      <CustomButton
                        variant="outline"
                        color="secondary"
                        size="md"
                        fullWidth
                      >
                        {t("actions.writeReview")}
                      </CustomButton>
                    </LocalizedClientLink>
                  )}
                </div>
              )}
              {!orderActions && !item.reviewHref && (
                <div className="hidden shrink-0 border-l border-gray-200 md:w-48 md:group-has-[[data-order-actions]]/items:block" />
              )}
            </li>
          )
        })}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 w-full cursor-pointer rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          {t("list.showMoreItems", { count: hiddenCount })}
        </button>
      )}

      {totalPrice && (
        <p className="mt-3 text-right text-sm text-gray-700">
          {t("list.totalPaid")}{" "}
          {originalPrice && (
            <span className="mr-1 text-gray-400 line-through">
              {originalPrice}
            </span>
          )}
          <span className="font-bold text-black">{totalPrice}</span>
        </p>
      )}
    </OrderCard>
  )
}
