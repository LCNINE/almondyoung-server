import Image from "next/image"
import Link from "next/link"
import * as React from "react"
import type { CategoryResponseDto } from "@lib/types/dto/pim"

// placeholder 이미지 (없을 때만 사용)
const PLACEHOLDER_IMAGE = "https://placehold.co/120x120?text=No+Image"

/**
 * 카테고리 탭 아이템의 데이터 구조
 */
interface CategoryCircleItemProps {
  category: CategoryResponseDto
  isSelected: boolean
  countryCode: string
  parentSlug: string
}

interface CategoryCircleTabsProps {
  items: CategoryResponseDto[]
  selectedId: string
  onSelect: (id: string) => void
  countryCode: string
  parentSlug: string
}

// --- 하위 컴포넌트: 개별 아이템 ---

function CategoryCircleItem({
  category,
  isSelected,
  countryCode,
  parentSlug,
}: CategoryCircleItemProps) {
  // 서버 데이터 구조: imageUrl 또는 thumbnail 사용
  const imageUrl = category.imageUrl || category.thumbnail || PLACEHOLDER_IMAGE

  // sub 페이지로 이동하는 링크 생성
  const href = `/${countryCode}/category/${parentSlug}/${category.slug}`

  return (
    <Link
      href={href}
      className="group flex flex-col items-center text-center outline-none"
    >
      {/* [디자인] 이전 HTML의 스타일 적용:
        - bg-muted, rounded-full, overflow-hidden
        - hover:scale-105 (호버 시 확대 애니메이션)
        - isSelected 상태일 때 시각적 강조 (ring 처리) 추가
      */}
      <div
        className={`bg-muted mb-2 max-h-[180px] max-w-[180px] overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-105 ${isSelected ? "ring-2 ring-black ring-offset-2" : ""
          }`}
      >
        <Image
          src={imageUrl}
          alt={category.name}
          width={117}
          height={117}
          loading="lazy"
        />
      </div>

      {/* 텍스트 스타일 */}
      <span
        className={`line-clamp-2 text-xs font-medium md:text-sm ${isSelected
          ? "font-bold text-black"
          : "text-gray-900 group-hover:text-gray-700"
          }`}
      >
        {category.name}
      </span>
    </Link>
  )
}

// --- 메인 컴포넌트: 탭 목록 ---

export function CategoryCircleTabs({
  items,
  selectedId,
  onSelect,
  countryCode,
  parentSlug,
}: CategoryCircleTabsProps) {
  return (
    <section className="mb-8 md:mb-12">
      {/* [디자인] 이전 HTML의 Grid 레이아웃 적용:
         - grid-cols-4 (모바일)
         - md:grid-cols-6 (데스크톱)
         - gap-4 / md:gap-6
      */}
      <div className="grid max-w-[1002px] grid-cols-4 gap-4 md:grid-cols-6 md:gap-6">
        {items.map((category) => (
          <CategoryCircleItem
            key={category.id}
            category={category}
            isSelected={selectedId === category.id}
            countryCode={countryCode}
            parentSlug={parentSlug}
          />
        ))}
      </div>
    </section>
  )
}
