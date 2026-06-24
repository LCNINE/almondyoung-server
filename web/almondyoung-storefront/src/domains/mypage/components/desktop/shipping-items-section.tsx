"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import { Package } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ShippingOrder } from "../../types/mypage-types"

interface ShippingItemsSectionProps {
  initialOrders: ShippingOrder[]
}

export function ShippingItemsSection({
  initialOrders,
}: ShippingItemsSectionProps) {
  const t = useTranslations("mypage.shipping")

  if (initialOrders.length === 0) {
    return (
      <section
        aria-labelledby="shipping-items-heading"
        className="bg-background mt-6 rounded-lg p-8"
      >
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-base font-medium text-gray-600">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-400">{t("emptyDescription")}</p>
          </div>
          <Button asChild>
            <LocalizedClientLink
              href="/best"
              className="mt-2 rounded-md px-4 py-2 text-sm text-white transition-colors"
            >
              {t("shopNow")}
            </LocalizedClientLink>
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="shipping-items-heading"
      className="bg-background mt-6 space-y-4 rounded-lg p-8"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-black">{t("title")}</h2>
        <LocalizedClientLink
          href="/mypage/order/list"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {t("viewAll")}
        </LocalizedClientLink>
      </div>
      {initialOrders.map((order) => (
        <OrderCardContent
          key={order.orderId}
          orderId={order.orderId}
          status={order.status}
          paymentStatus={order.paymentStatus}
          deliveryInfo={order.deliveryInfo}
          shippingNote={order.shippingNote}
          productName={order.productName}
          productImage={order.productImage}
          price={order.price}
          quantity={order.quantity}
          options={order.options}
          showInquiry={order.showInquiry}
          orderItems={order.orderItems}
          variantId={order.variantId}
          bankTransferStatus={order.bankTransferStatus}
        />
      ))}
    </section>
  )
}
