import { ChevronRight } from "lucide-react"
import Image from "next/image"
import React from "react"

// --- 1. 데이터 타입 정의 ---
type OrderStatus = "SHIPPING" | "PREPARING"

interface OrderItem {
  id: string
  orderNumber: string
  status: OrderStatus
  statusLabel: string
  thumbnail: string
}

// --- 2. 목업 데이터 ---
const orderList: OrderItem[] = [
  {
    id: "1",
    orderNumber: "20102-202031",
    status: "SHIPPING",
    statusLabel: "배송 중",
    thumbnail: "https://placehold.co/44x45", // (예시 이미지)
  },
  {
    id: "2",
    orderNumber: "20232-202031",
    status: "PREPARING",
    statusLabel: "상품 준비 중",
    thumbnail: "https://placehold.co/44x45",
  },
]

// --- 3. 개별 아이템 컴포넌트 (분리) ---
function ShippingItem({ item }: { item: OrderItem }) {
  // 상태에 따른 텍스트 색상 결정
  const statusColor =
    item.status === "SHIPPING" ? "text-[#007aff]" : "text-black"

  return (
    <li className="flex w-full items-center gap-4 py-1">
      {/* 썸네일 */}
      <div className="relative h-[45px] w-11 flex-shrink-0 overflow-hidden rounded-[5px] border border-[#d9d9d9]/50">
        <Image
          src={item.thumbnail}
          alt={`주문번호 ${item.orderNumber}`}
          fill
          className="object-cover"
          unoptimized // placehold.co 사용 시 필요 (실제 이미지 사용 시 제거 가능)
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

      {/* 아이콘 (Lucide) */}
      <button type="button" aria-label="상세보기" className="text-[#1E1E1E]">
        <ChevronRight size={24} strokeWidth={1.5} />
      </button>
    </li>
  )
}

// --- 4. 메인 컴포넌트 ---
export default function ShippingStatusCard() {
  return (
    // PARENT:
    // - w-full max-w-md: 반응형이되, 너무 넓어지지 않도록 제한
    // - p-4: 적절한 내부 여백
    <section className="flex w-full max-w-md flex-col gap-3">
      {/* Header */}
      <h2 className="text-base font-bold text-black">배송 중 상품</h2>

      {/* List Container */}
      <div
        className="flex flex-col gap-4 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white px-4 py-3.5"
        // 원본 디자인의 그림자 값 적용
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
