"use client"

import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@/lib/utils"
import OrderItemCartButton from "./order-item-cart-button"
import { groupOrderItems, type OrderStatusGroup } from "./order-status-groups"
import type { OrderSummaryItem } from "./order-summary-items"

function ItemLink({
  href,
  className,
  children,
}: {
  href?: string
  className?: string
  children: ReactNode
}) {
  if (!href) {
    return <div className={className}>{children}</div>
  }

  return (
    <LocalizedClientLink href={href} className={className}>
      {children}
    </LocalizedClientLink>
  )
}

function StatusCard({
  group,
  paymentStatusLabel,
  collapsible,
  hideDigitalDownload,
  children,
}: {
  group: OrderStatusGroup
  paymentStatusLabel?: string
  collapsible?: boolean
  hideDigitalDownload?: boolean
  children?: ReactNode
}) {
  const t = useTranslations("mypage.order")
  const [expanded, setExpanded] = useState(false)
  const items = collapsible && !expanded ? group.items.slice(0, 3) : group.items
  const hiddenCount = group.items.length - items.length
  const returnLinks = Array.from(
    new Map(
      group.items
        .flatMap((item) => item.returnLinks ?? [])
        .map((link) => [link.href, link])
    ).values()
  )
  const reviewHrefs = Array.from(
    new Set(
      group.items.flatMap((item) => (item.reviewHref ? [item.reviewHref] : []))
    )
  )
  const hasActions = Boolean(
    children || returnLinks.length || reviewHrefs.length
  )

  return (
    <li className="flex flex-col rounded-lg border border-gray-200 bg-white md:flex-row">
      <div className="min-w-0 flex-1 p-4 md:p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-base font-bold md:text-lg">
            <span
              className={
                group.status.includes("배송") ? "text-primary" : "text-gray-900"
              }
            >
              {group.status}
            </span>
            {group.hint && (
              <span className="font-medium text-gray-500"> · {group.hint}</span>
            )}
            {group.isOrderStatus &&
              paymentStatusLabel &&
              paymentStatusLabel !== group.status && (
                <span className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                  {paymentStatusLabel}
                </span>
              )}
          </h3>
        </div>
        <div className="divide-y divide-gray-100">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3.5 py-4 first:pt-0 last:pb-0"
            >
              <ItemLink href={item.href} className="shrink-0">
                <img
                  className="h-20 w-20 rounded-md border border-gray-200 object-cover"
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
                    {item.discountNote && (
                      <p className="text-destructive">{item.discountNote}</p>
                    )}
                    {item.options?.map((option, index) => (
                      <p key={index}>- {option}</p>
                    ))}
                    {item.statusHint && item.statusHint !== group.hint && (
                      <p>{item.statusHint}</p>
                    )}
                  </div>
                  {item.isDigital ? (
                    hideDigitalDownload ? null : (
                      <LocalizedClientLink href="/mypage/download">
                        <CustomButton
                          variant="outline"
                          color="secondary"
                          size="sm"
                        >
                          {t("actions.download")}
                        </CustomButton>
                      </LocalizedClientLink>
                    )
                  ) : item.variantId ? (
                    <OrderItemCartButton variantId={item.variantId} />
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-3 w-full rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            {t("list.showMoreItems", { count: hiddenCount })}
          </button>
        )}
      </div>
      <div
        className={cn(
          "shrink-0 flex-col gap-2 border-t border-gray-200 p-4 md:flex md:w-48 md:border-t-0 md:border-l md:p-5",
          hasActions ? "flex" : "hidden"
        )}
      >
        {returnLinks.map((link) => (
          <LocalizedClientLink key={link.href} href={link.href}>
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              fullWidth
            >
              {link.label}
            </CustomButton>
          </LocalizedClientLink>
        ))}
        {children}
        {reviewHrefs.map((href) => (
          <LocalizedClientLink key={href} href={href}>
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              fullWidth
            >
              {t("actions.writeReview")}
            </CustomButton>
          </LocalizedClientLink>
        ))}
      </div>
    </li>
  )
}

export default function OrderStatusCards({
  status,
  deliveryInfo,
  items,
  paymentStatusLabel,
  collapsible,
  hideDigitalDownload,
  children,
}: {
  status: string
  deliveryInfo?: string
  items: OrderSummaryItem[]
  paymentStatusLabel?: string
  collapsible?: boolean
  hideDigitalDownload?: boolean
  children?: ReactNode
}) {
  const groups = groupOrderItems(items, status, deliveryInfo)

  return (
    <ul className="flex flex-col gap-3">
      {groups.map((group) => (
        <StatusCard
          key={group.key}
          group={group}
          paymentStatusLabel={paymentStatusLabel}
          collapsible={collapsible}
          hideDigitalDownload={hideDigitalDownload}
        >
          {group.isOrderStatus ? children : null}
        </StatusCard>
      ))}
    </ul>
  )
}
