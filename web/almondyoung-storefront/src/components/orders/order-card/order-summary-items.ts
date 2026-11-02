import type { HttpTypes } from "@medusajs/types"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import { isDigitalItem } from "@/lib/api/medusa/shipping-method-policy"
import {
  DATE_FORMATS,
  formatDate as formatDateText,
} from "@/lib/utils/format-date"
import {
  itemReturnStatus,
  originalLineTotal,
  type ItemReturnStatus,
} from "@/domains/order/list/item-return-status"

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
  statusLabel?: string
  statusHint?: string
  returnLinks?: { href: string; label: string }[]
}

type OrderItemTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string

function returnStatusText(
  status: ItemReturnStatus,
  lineQuantity: number,
  tList: OrderItemTranslator
): { label: string; hint?: string } {
  const hints: string[] = []

  if (status.quantity < lineQuantity) {
    hints.push(tList("itemReturn.quantity", { count: status.quantity }))
  }

  if (status.key === "returning" || status.key === "exchanging") {
    hints.push(
      tList(
        status.stage === "processing"
          ? "itemReturn.inspecting"
          : "itemReturn.waitingPickup"
      )
    )
  } else if (status.key === "returned" && status.refundedAt) {
    hints.push(
      tList("itemReturn.refundedOn", {
        date: formatDateText(status.refundedAt, DATE_FORMATS.KO_DOT),
      })
    )
  }

  return {
    label: tList(`itemReturn.${status.key}`),
    hint: hints.length > 0 ? hints.join(" · ") : undefined,
  }
}

export function mapOrderSummaryItems(
  order: HttpTypes.StoreOrder,
  orderReturns: CustomerReturn[],
  tList: OrderItemTranslator,
  reviewHrefs: Record<string, string> = {}
): OrderSummaryItem[] {
  return (order.items ?? []).map((item) => {
    const handle = item.product_handle || item.variant?.product?.handle
    const returnStatus = itemReturnStatus(item.id, orderReturns)
    const lineTotal = returnStatus
      ? originalLineTotal(item)
      : typeof item.total === "number"
        ? item.total
        : (item.unit_price ?? 0) * (item.quantity ?? 0)
    const returnText = returnStatus
      ? returnStatusText(returnStatus, item.quantity ?? 0, tList)
      : null

    return {
      id: item.id,
      title:
        item.title ||
        item.variant?.product?.title ||
        tList("defaultProductName"),
      thumbnail:
        item.thumbnail ||
        item.variant?.product?.thumbnail ||
        "https://placehold.co/80x80",
      href: handle ? `/products/${handle}` : undefined,
      price: `${lineTotal.toLocaleString()}원 · ${tList("itemQuantity", { count: item.quantity ?? 0 })}`,
      options:
        item.variant?.title && item.variant.title !== "Default"
          ? [item.variant.title]
          : [],
      variantId: item.variant_id ?? undefined,
      isDigital: isDigitalItem(item),
      reviewHref: reviewHrefs[item.id],
      ...(returnStatus && returnText
        ? {
            statusLabel: returnText.label,
            statusHint: returnText.hint,
            returnLinks: orderReturns
              .filter(
                (ret) =>
                  itemReturnStatus(item.id, [ret])?.key === returnStatus.key
              )
              .map((ret) => ({
                href: `/mypage/order/returns/${encodeURIComponent(ret.returnId)}?orderId=${encodeURIComponent(order.id)}`,
                label: tList(
                  returnStatus.key === "exchanging" ||
                    returnStatus.key === "exchanged"
                    ? "itemReturn.viewExchangeDetail"
                    : "itemReturn.viewReturnDetail"
                ),
              })),
          }
        : {}),
    }
  })
}
