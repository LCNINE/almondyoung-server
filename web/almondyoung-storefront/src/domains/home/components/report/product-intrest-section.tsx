"use client"

import { ScrollArea, ScrollBar } from "@components/common/ui/scroll-area"
import { BasicProductCard } from "../../../../components/products/product-card"
import type { ProductCard } from "@lib/types/ui/product"
import Image from "next/image"

// --- 1. 목업 데이터 및 타입 정의 ---

type MockProduct = {
  id: string
  name: string
  thumbnail: string
  image: string
  price: {
    original: number
    member: number
    discountRate: number
  }
}

type Product = ProductCard

const mockRecentViews = [
  { productId: "rv1", thumbnail: "https://picsum.photos/seed/rv1/100/100" },
  { productId: "rv2", thumbnail: "https://picsum.photos/seed/rv2/100/100" },
  { productId: "rv3", thumbnail: "https://picsum.photos/seed/rv3/100/100" },
  { productId: "rv4", thumbnail: "https://picsum.photos/seed/rv4/100/100" },
  { productId: "rv5", thumbnail: "https://picsum.photos/seed/rv5/100/100" },
]

const mockProductDb: { [key: string]: MockProduct } = {
  rv1: {
    id: "rv1",
    name: "클래식 레더 재킷 (샘플)",
    thumbnail: "https://picsum.photos/seed/rv1/100/100",
    image: "https://picsum.photos/seed/rv1/300/300",
    price: { original: 130000, member: 125000, discountRate: 5 },
  },
  rv2: {
    id: "rv2",
    name: "데님 오버롤 팬츠 (샘플)",
    thumbnail: "https://picsum.photos/seed/rv2/100/100",
    image: "https://picsum.photos/seed/rv2/300/300",
    price: { original: 78000, member: 70000, discountRate: 10 },
  },
  // ... (다른 목업 데이터) ...
}

const mockRelatedProducts: MockProduct[] = [
  {
    id: "rel1",
    name: "관련 상품 A",
    thumbnail: "https://picsum.photos/seed/rel1/300/300",
    image: "https://picsum.photos/seed/rel1/300/300",
    price: { original: 15000, member: 12000, discountRate: 20 },
  },
  {
    id: "rel2",
    name: "관련 상품 B",
    thumbnail: "https://picsum.photos/seed/rel2/300/300",
    image: "https://picsum.photos/seed/rel2/300/300",
    price: { original: 22000, member: 20000, discountRate: 10 },
  },
  {
    id: "rel3",
    name: "관련 상품 C",
    thumbnail: "https://picsum.photos/seed/rel3/300/300",
    image: "https://picsum.photos/seed/rel3/300/300",
    price: { original: 50000, member: 45000, discountRate: 10 },
  },
  {
    id: "rel4",
    name: "관련 상품 D",
    thumbnail: "https://picsum.photos/seed/rel4/300/300",
    image: "https://picsum.photos/seed/rel4/300/300",
    price: { original: 9900, member: 8900, discountRate: 10 },
  },
  {
    id: "rel5",
    name: "관련 상품 E",
    thumbnail: "https://picsum.photos/seed/rel5/300/300",
    image: "https://picsum.photos/seed/rel5/300/300",
    price: { original: 12000, member: 10000, discountRate: 16 },
  },
  {
    id: "rel6",
    name: "관련 상품 F",
    thumbnail: "https://picsum.photos/seed/rel6/300/300",
    image: "https://picsum.photos/seed/rel6/300/300",
    price: { original: 75000, member: 60000, discountRate: 20 },
  },
  {
    id: "rel7",
    name: "관련 상품 G",
    thumbnail: "https://picsum.photos/seed/rel7/300/300",
    image: "https://picsum.photos/seed/rel7/300/300",
    price: { original: 33000, member: 30000, discountRate: 9 },
  },
]

// --- 3. 순수 정적 UI 컴포넌트 ---
export default function ProductIntrestSection() {
  // [제거] user prop 제거
  // [제거] useState 제거

  // [수정] "보이는 게 디폴트" - 첫 번째 아이템을 기본으로 고정합니다.
  const selectedProductId = mockRecentViews[0].productId

  // [수정] 고정된 ID를 기반으로 정적 데이터를 파생합니다.
  const selectedRecentProduct = mockProductDb[selectedProductId] || null
  const relatedProducts = mockRelatedProducts
  const grid = (
    selectedRecentProduct ? [selectedRecentProduct, ...relatedProducts] : []
  ).slice(0, 8)

  return (
    <section className="w-full">
      <h2 className="mb-3 text-xl font-bold md:mb-4 md:text-2xl">
        관심있게 본 상품
      </h2>

      {/* 최근 본 상품 썸네일 (탭 역할) */}
      <ScrollArea className="w-full">
        <div className="m-1 flex gap-3 p-2 md:gap-4">
          {mockRecentViews.map((rv) => (
            <div key={rv.productId} className="flex flex-col items-center">
              {/* [수정] onClick 제거, button -> div로 변경 (시맨틱) */}
              <div
                className={`m-1 mb-2 h-18 w-18 rounded-full transition-all md:h-20 md:w-20 ${
                  // [유지] 이 로직은 selectedProductId가 상수이므로 정적으로 작동합니다.
                  selectedProductId === rv.productId
                    ? "ring-gray-80 ring-3 ring-offset-2"
                    : "opacity-70" // 비활성 탭 스타일 (예시)
                }`}
              >
                <div className="border-gray-20 h-18 w-18 overflow-hidden rounded-full border md:h-20 md:w-20">
                  <Image
                    src={rv.thumbnail}
                    alt="최근 본 상품"
                    width={80}
                    height={80}
                    unoptimized={true}
                    className="h-full w-full object-cover"
                  />
                </div>
                {selectedProductId === rv.productId && (
                  <div className="border-t-gray-80 m-1 mx-auto h-0 w-0 border-t-[6px] border-r-[8px] border-l-[8px] border-r-transparent border-l-transparent" />
                )}
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="mt-4 text-[16px] font-bold md:text-[18px]">
        {selectedRecentProduct
          ? `'${selectedRecentProduct.name}' 관련 상품`
          : ""}
      </div>

      {/* 상품 그리드 */}
      <div className="mt-6 grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-2 lg:gap-4">
        {grid.map((p, idx) => {
          return (
            <div key={p.id} className="relative">
              {idx === 0 && selectedRecentProduct ? (
                <div className="absolute top-0 left-0 z-10 bg-black px-4 py-2 text-[10px] text-white md:text-xs">
                  찾아본 상품
                </div>
              ) : null}
              <BasicProductCard product={p as Product} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
