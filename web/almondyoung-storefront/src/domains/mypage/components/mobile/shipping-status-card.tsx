"use client"

import { ChevronRight } from "lucide-react"
import Image from "next/image"
import React, { useEffect, useState } from "react"
import { getOrders } from "@lib/api/medusa/orders"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"

// --- 1. 데이터 타입 정의 ---
type OrderStatus = "SHIPPING" | "PREPARING"

interface OrderItem {
  id: string
  orderNumber: string
  status: OrderStatus
  statusLabel: string
  thumbnailUrl: string
}

// --- 3. 개별 아이템 컴포넌트 ---
function ShippingItem({ item }: { item: OrderItem }) {
  const statusColor =
    item.status === "SHIPPING" ? "text-[#007aff]" : "text-black"

  return (
    <Link href={`/kr/mypage/order/details?orderId=${item.id}`}>
      <li className="flex w-full items-center gap-4 py-1 transition-opacity hover:opacity-80">
        {/* 썸네일 */}
        <div className="relative h-[45px] w-11 shrink-0 overflow-hidden rounded-[5px] border border-[#d9d9d9]/50">
          <Image
            src={item.thumbnailUrl}
            alt={`주문번호 ${item.orderNumber}`}
            fill
            sizes="44px"
            className="object-cover"
          />
        </div>

        {/* 텍스트 정보 */}
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-[#5a5a5a]">
            주문번호 {item.orderNumber}
          </span>
          <span className={`text-base font-medium ${statusColor}`}>
            {item.statusLabel}
          </span>
        </div>

        {/* 아이콘 */}
        <button type="button" aria-label="상세보기" className="text-[#1E1E1E]">
          <ChevronRight size={24} strokeWidth={1.5} />
        </button>
      </li>
    </Link>
  )
}

// --- 4. 메인 컴포넌트 ---
export default function ShippingStatusCard() {
  const [orderList, setOrderList] = useState<OrderItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const ordersData = await getOrders({ limit: 10 })

        // Medusa 주문 데이터를 OrderItem으로 변환
        const shippingOrders: OrderItem[] = (ordersData?.orders || [])
          .filter((order) => {
            const fulfillmentStatus = order.fulfillment_status
            return (
              fulfillmentStatus === "partially_fulfilled" ||
              fulfillmentStatus === "fulfilled" ||
              fulfillmentStatus === "shipped" ||
              fulfillmentStatus === "not_fulfilled"
            )
          })
          .slice(0, 2)
          .map((order) => {
            const fulfillmentStatus = order.fulfillment_status
            let status: OrderStatus = "PREPARING"
            let statusLabel = "상품 준비 중"

            if (
              fulfillmentStatus === "shipped" ||
              fulfillmentStatus === "fulfilled"
            ) {
              status = "SHIPPING"
              statusLabel = "배송 중"
            } else if (fulfillmentStatus === "partially_fulfilled") {
              status = "SHIPPING"
              statusLabel = "부분 배송 중"
            }

            const thumbnail =
              order.items?.[0]?.thumbnail ||
              order.items?.[0]?.variant?.product?.thumbnail ||
              "https://placehold.co/44x45"
            const thumbnailUrl = getThumbnailUrl(thumbnail)

            return {
              id: order.id,
              orderNumber:
                order.display_id?.toString() || order.id.slice(0, 12),
              status,
              statusLabel,
              thumbnailUrl,
            }
          })

        setOrderList(shippingOrders)
      } catch (error) {
        console.error("주문 조회 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchOrders()
  }, [])

  if (isLoading) {
    return (
      <section className="flex w-full flex-col gap-3">
        <h2 className="text-base font-bold text-black">배송 중 상품</h2>
        <div className="flex flex-col gap-4 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white px-4 py-3.5">
          <div className="flex flex-col gap-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={`shipping-mobile-skeleton-${index}`} className="flex items-center gap-4">
                <Skeleton className="h-[45px] w-11 rounded-[5px]" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Skeleton className="h-6 w-6 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (orderList.length === 0) {
    return (
      <section className="flex w-full flex-col gap-3">
        <h2 className="text-base font-bold text-black">배송 중 상품</h2>
        <div className="flex flex-col gap-4 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white px-4 py-3.5 shadow-sm">
          <p className="py-4 text-center text-sm text-gray-500">
            배송 중인 상품이 없습니다
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="text-base font-bold text-black">배송 중 상품</h2>

      <div
        className="flex flex-col gap-4 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white px-4 py-3.5"
        style={{ boxShadow: "0px 4px 10px 0 rgba(0,0,0,0.1)" }}
      >
        <ul className="flex flex-col gap-4">
          {orderList.map((item) => (
            <ShippingItem key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </section>
  )
}
