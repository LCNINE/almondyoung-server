"use client"

import React, { useState } from "react"
import Link from "next/link"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@lib/utils"

interface ProductFilterSidebarProps {
  categories?: StoreProductCategoryTree[]
  currentCategoryId?: string
  countryCode?: string
}

interface CategoryLinkProps {
  category: StoreProductCategoryTree
  isActive: boolean
  isExpanded: boolean
  onToggle: () => void
  countryCode: string
  level: number
  currentCategoryId?: string
}

function CategoryLink({
  category,
  isActive,
  isExpanded,
  onToggle,
  countryCode,
  level,
  currentCategoryId,
}: CategoryLinkProps) {
  const hasChildren =
    category.category_children && category.category_children.length > 0

  return (
    <li className="self-stretch">
      <div className="flex w-full items-center justify-between">
        <Link
          href={`/${countryCode}/category/${category.handle}`}
          className={cn(
            "flex-1 py-1 font-['Pretendard'] text-base",
            isActive
              ? "font-bold text-blue-600"
              : "font-medium text-stone-900 hover:text-blue-600"
          )}
        >
          {category.name}
        </Link>
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              onToggle()
            }}
            className="p-1 text-stone-500 hover:text-stone-900"
            aria-label={isExpanded ? "접기" : "펼치기"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul className="mt-2 flex flex-col gap-2 pl-4">
          {category.category_children!.map((child) => (
            <CategoryLinkItem
              key={child.id}
              category={child}
              countryCode={countryCode}
              level={level + 1}
              currentCategoryId={currentCategoryId}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function CategoryLinkItem({
  category,
  countryCode,
  level,
  currentCategoryId,
}: {
  category: StoreProductCategoryTree
  countryCode: string
  level: number
  currentCategoryId?: string
}) {
  const isActive = category.id === currentCategoryId
  const hasActiveChild = checkHasActiveChild(category, currentCategoryId)
  const [isExpanded, setIsExpanded] = useState(isActive || hasActiveChild)

  return (
    <CategoryLink
      category={category}
      isActive={isActive}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      countryCode={countryCode}
      level={level}
      currentCategoryId={currentCategoryId}
    />
  )
}

function checkHasActiveChild(
  category: StoreProductCategoryTree,
  currentCategoryId?: string
): boolean {
  if (!currentCategoryId || !category.category_children) return false

  for (const child of category.category_children) {
    if (child.id === currentCategoryId) return true
    if (checkHasActiveChild(child, currentCategoryId)) return true
  }

  return false
}

export default function ProductFilterSidebar({
  categories = [],
  currentCategoryId,
  countryCode = "kr",
}: ProductFilterSidebarProps) {
  if (categories.length === 0) {
    return null
  }

  return (
    <div className="sticky top-4 hidden w-full max-w-60 min-w-56 flex-col items-start gap-7 rounded-2xl border border-gray-300 px-7 py-10 font-['Pretendard'] md:flex">
      {/* 카테고리 섹션 */}
      <nav aria-label="카테고리" className="flex w-full flex-col gap-4">
        <h2 className="self-stretch text-lg font-bold text-stone-900">
          카테고리
        </h2>
        <ul className="flex flex-col items-start gap-3 pl-2">
          {categories.map((category) => (
            <CategoryLinkItem
              key={category.id}
              category={category}
              countryCode={countryCode}
              level={0}
              currentCategoryId={currentCategoryId}
            />
          ))}
        </ul>
      </nav>
    </div>
  )
}
