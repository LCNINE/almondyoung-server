"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils/format-date"
import OrderSummaryCard from "@components/orders/order-card/order-summary-card"
import { ChevronRight, Package } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { ShippingOrder } from "../../types/mypage-types"

interface ShippingItemsSectionProps {
  initialOrders: ShippingOrder[]
}

function ShippingCard({ order }: { order: ShippingOrder }) {
  const t = useTranslations("mypage.shipping")

  // TODO(물류 API 연동): 배송조회 버튼을 실제 택배사 트래킹 화면으로 연결.
  // 현재는 도착 예정일/송장 트래킹 데이터 소스가 없어 고객센터 안내 토스트로 대체한다.
  // deliveryInfo(ShippingOrder) 자리도 물류 API 의 ETA 로 채우면 상태 옆에 "· 7/15(수) 도착 예정" 노출됨.
  const handleTrack = () => {
    toast.info(t("trackToast"))
  }

  return (
    <OrderSummaryCard
      orderId={order.orderId}
      orderDate={formatDate(order.createdAt, "yyyy. M. d")}
      status={order.status}
      deliveryInfo={order.deliveryInfo}
      productName={order.productName}
      productImage={order.productImage}
      price={order.price}
      options={order.options}
    >
      <Button variant="outline" onClick={handleTrack} className="w-full">
        {t("trackButton")}
      </Button>
    </OrderSummaryCard>
  )
}

export function ShippingItemsSection({
  initialOrders,
}: ShippingItemsSectionProps) {
  const t = useTranslations("mypage.shipping")

  if (initialOrders.length === 0) {
    return (
      <section className="bg-background mt-6 rounded-lg p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <Package className="h-12 w-12 text-gray-300" />
          <div className="text-center">
            <p className="text-base font-medium text-gray-600">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {t("emptyDescription")}
            </p>
          </div>
          <Button asChild>
            <LocalizedClientLink href="/best">
              {t("shopNow")}
            </LocalizedClientLink>
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-black">{t("orderTitle")}</h2>
        <LocalizedClientLink
          href="/mypage/order/list"
          className="text-primary flex items-center gap-0.5 text-sm font-medium"
        >
          {t("viewAll")}
          <ChevronRight className="h-4 w-4" />
        </LocalizedClientLink>
      </div>
      {initialOrders.map((order) => (
        <ShippingCard key={order.orderId} order={order} />
      ))}
    </section>
  )
}
