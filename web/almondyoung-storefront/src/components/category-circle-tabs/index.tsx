import Image from "next/image"
import * as React from "react"

// --- 데이터 타입 및 더미 데이터 ---

// 더미 이미지 풀 (이미지가 없을 때 사용)
const PLACEHOLDER_IMAGES = [
  "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
  "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
  "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
  "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
  "https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg",
  "https://almondyoung.com/web/product/medium/202502/db90e9f1a6ccdf71d4aa82ed1d405981.png",
  "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
  "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
  "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
  "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
]

/**
 * 카테고리 탭 아이템의 데이터 구조
 */ interface CategoryCircleItemProps {
  name: string
  imageUrl: string
  id: string
  isSelected: boolean
  onSelect: (id: string) => void
}

interface CategoryCircleTabsProps {
  items: {
    id: string
    name: string
    imageUrl: string
  }[]
  selectedId: string
  onSelect: (id: string) => void
}

// --- 하위 컴포넌트: 개별 아이템 ---

function CategoryCircleItem({
  name,
  imageUrl,
  id,
  isSelected,
  onSelect,
}: CategoryCircleItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="group flex flex-col items-center text-center outline-none"
    >
      {/* [디자인] 이전 HTML의 스타일 적용:
        - bg-muted, rounded-full, overflow-hidden
        - hover:scale-105 (호버 시 확대 애니메이션)
        - isSelected 상태일 때 시각적 강조 (ring 처리) 추가
      */}
      <div
        className={`bg-muted mb-2 max-h-[180px] max-w-[180px] overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-105 ${
          isSelected ? "ring-2 ring-black ring-offset-2" : ""
        }`}
      >
        <Image
          src={imageUrl}
          alt={name}
          width={117}
          height={117}
          loading="lazy"
        />
      </div>

      {/* 텍스트 스타일 */}
      <span
        className={`line-clamp-2 text-xs font-medium md:text-sm ${
          isSelected
            ? "font-bold text-black"
            : "text-gray-900 group-hover:text-gray-700"
        }`}
      >
        {name}
      </span>
    </button>
  )
}

// --- 메인 컴포넌트: 탭 목록 ---

export function CategoryCircleTabs({
  items,
  selectedId,
  onSelect,
}: CategoryCircleTabsProps) {
  return (
    <section className="mb-8 md:mb-12">
      {/* [디자인] 이전 HTML의 Grid 레이아웃 적용:
         - grid-cols-4 (모바일)
         - md:grid-cols-6 (데스크톱)
         - gap-4 / md:gap-6
      */}
      <div className="grid max-w-[1002px] grid-cols-4 gap-4 md:grid-cols-6 md:gap-6">
        {items.map((item) => (
          <CategoryCircleItem
            key={item.id}
            id={item.id}
            name={item.name}
            imageUrl={item.imageUrl}
            isSelected={selectedId === item.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}
