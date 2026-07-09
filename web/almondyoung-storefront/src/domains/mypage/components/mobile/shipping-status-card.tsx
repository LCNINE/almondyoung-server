"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import type { OrderItem } from "../../types/mypage-types"

function OrderCard({ item }: { item: OrderItem }) {
  const statusColor = item.status === "SHIPPING" ? "text-primary" : "text-black"

  return (
    <LocalizedClientLink
      href={`/mypage/order/details?orderId=${item.id}`}
      className="w-[160px] shrink-0"
    >
      <div className="flex h-full flex-col gap-3 rounded-lg border border-[#ececec] bg-white p-3.5 transition-opacity hover:opacity-80">
        <span className={`text-[15px] leading-snug font-bold ${statusColor}`}>
          {item.statusLabel}
        </span>
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-gray-50">
          <Image
            src={getThumbnailUrl(item.thumbnailUrl)}
            alt={item.statusLabel}
            fill
            sizes="160px"
            className="object-cover"
          />
        </div>
      </div>
    </LocalizedClientLink>
  )
}

interface ShippingStatusCardProps {
  initialOrders: OrderItem[]
}

export default function ShippingStatusCard({
  initialOrders,
}: ShippingStatusCardProps) {
  const t = useTranslations("mypage.shipping")

  return (
    <section className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-black">{t("orderTitle")}</h2>
        <LocalizedClientLink
          href="/mypage/order/list"
          className="text-primary flex items-center gap-0.5 text-xs font-medium"
        >
          {t("viewAll")}
          <ChevronRight className="h-3.5 w-3.5" />
        </LocalizedClientLink>
      </div>

      {initialOrders.length === 0 ? (
        <div className="rounded-lg border border-[#ececec] bg-white px-4 py-6 text-center">
          <p className="text-sm text-gray-500">{t("emptyTitle")}</p>
        </div>
      ) : (
        <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {initialOrders.map((item) => (
            <OrderCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
