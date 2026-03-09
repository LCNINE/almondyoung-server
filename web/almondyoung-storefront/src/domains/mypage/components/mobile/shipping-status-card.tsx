import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { ChevronRight } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import type { OrderItem } from "../../types/mypage-types"

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
            src={getThumbnailUrl(item.thumbnailUrl)}
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

// --- 메인 컴포넌트 ---
interface ShippingStatusCardProps {
  initialOrders: OrderItem[]
}

export default function ShippingStatusCard({
  initialOrders,
}: ShippingStatusCardProps) {
  if (initialOrders.length === 0) {
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
          {initialOrders.map((item) => (
            <ShippingItem key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </section>
  )
}
