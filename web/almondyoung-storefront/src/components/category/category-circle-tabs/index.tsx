import Link from "next/link"
import * as React from "react"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"

// placeholder 이미지 (없을 때만 사용)
const PLACEHOLDER_IMAGE = "https://placehold.co/120x120?text=No+Image"

/**
 * 카테고리 탭 아이템의 데이터 구조
 */
type CategoryCircleItem = {
  id: string
  name: string
  handle?: string | null
  metadata?: Record<string, unknown> | null
  imageUrl?: string | null
  thumbnail?: string | null
}

interface CategoryCircleItemProps {
  category: CategoryCircleItem
  isSelected: boolean
  countryCode?: string
  parentSlug?: string
  onSelect?: (id: string) => void
}

interface CategoryCircleTabsProps {
  items: CategoryCircleItem[]
  selectedId: string
  onSelect?: (id: string) => void
  countryCode?: string
  parentSlug?: string
}

// --- 하위 컴포넌트: 개별 아이템 ---

function CategoryCircleItem({
  category,
  isSelected,
  countryCode,
  parentSlug,
  onSelect,
}: CategoryCircleItemProps) {
  const metadata = category.metadata as
    | { imageUrl?: unknown; image_url?: unknown; thumbnail?: unknown }
    | null
    | undefined
  const metadataImage =
    (typeof metadata?.imageUrl === "string" && metadata.imageUrl) ||
    (typeof metadata?.image_url === "string" && metadata.image_url) ||
    (typeof metadata?.thumbnail === "string" && metadata.thumbnail) ||
    null

  const imageUrl =
    category.imageUrl || category.thumbnail || metadataImage || PLACEHOLDER_IMAGE

  const href =
    countryCode && parentSlug && category.handle
      ? `/${countryCode}/category/${parentSlug}/${category.handle}`
      : null

  const content = (
    <>
      <div
        className={`bg-muted mb-2 max-h-[180px] max-w-[180px] overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-105 ${
          isSelected ? "ring-2 ring-black ring-offset-2" : ""
        }`}
      >
        <img
          src={imageUrl === PLACEHOLDER_IMAGE ? imageUrl : getThumbnailUrl(imageUrl)}
          alt={category.name}
          width={117}
          height={117}
          loading="lazy"
          className="h-[117px] w-[117px] object-cover"
        />
      </div>

      <span
        className={`line-clamp-2 text-xs font-medium md:text-sm ${
          isSelected
            ? "font-bold text-black"
            : "text-gray-900 group-hover:text-gray-700"
        }`}
      >
        {category.name}
      </span>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="group flex flex-col items-center text-center outline-none"
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className="group flex flex-col items-center text-center outline-none"
      onClick={() => onSelect?.(category.id)}
    >
      {content}
    </button>
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
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}
