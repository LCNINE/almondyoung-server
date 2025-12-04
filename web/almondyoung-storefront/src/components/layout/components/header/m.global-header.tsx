"use client"

import { CategorySheet } from "@components/category/categorySheet"
import { useCategories } from "@lib/providers/category-provider"
import type { PimCategory } from "@lib/api/pim"
import { UserBasicInfo } from "@lib/types/ui/user"
import { Bell, Menu, Search } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import React, { useMemo, useState } from "react"
import CartSheet from "../../../cart/cart-sheet"
import { useUser } from "contexts/user-context"
import { getShowOnMainCategory } from "@lib/utils/category-display-settings"

// 기본 카테고리 제거 - 서버 데이터만 사용

// 사용자 전문 분야 하이라이트용
const getSpecialtyCategories = (specialties: string[]): string[] => {
  const map: Record<string, string[]> = {
    속눈썹: ["속눈썹", "속눈썹 연장", "속눈썹 펌"],
    네일: ["네일", "네일아트", "네일 도구"],
    피부: ["피부미용", "스킨케어", "페이셜"],
    메이크업: ["메이크업", "화장품"],
    헤어: ["헤어", "헤어케어"],
    타투: ["타투", "타투아트"],
    왁싱: ["왁싱", "제모"],
    반영구: ["반영구", "반영구화장"],
  }

  const result: string[] = []
  specialties.forEach((specialty) => {
    const keywords = map[specialty] || []
    result.push(...keywords)
  })

  return result
}

/**
 * 모바일 글로벌 헤더
 *
 * 포함 요소:
 * - 햄버거 메뉴 (카테고리 시트)
 * - 검색 인풋
 * - 알림 버튼
 * - 카테고리 가로 스크롤 리스트
 *
 * 사용처: 홈, 검색, 베스트 등 최상위 페이지
 */
export const MobileGlobalHeader: React.FC = () => {
  const { user } = useUser()
  const pathname = usePathname()
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const { categories } = useCategories()

  // 상단 노출용 카테고리 (최대 8개)
  // showOnMainCategory가 true인 카테고리만 필터링하고 sortOrder 순으로 정렬
  const topCategories: PimCategory[] = useMemo(() => {
    if (!Array.isArray(categories) || categories.length === 0) {
      if (process.env.NODE_ENV === "development") {
        console.log("[MobileGlobalHeader] 카테고리가 없습니다")
      }
      return []
    }

    const filtered = categories.filter((cat) => getShowOnMainCategory(cat))
    const sorted = filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    const sliced = sorted.slice(0, 8)

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[MobileGlobalHeader] 카테고리 필터링: 전체 ${categories.length}개 → showOnMainCategory=true ${filtered.length}개 → 정렬 후 ${sorted.length}개 → 최종 ${sliced.length}개`
      )
    }

    return sliced
  }, [categories])

  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [showNotification] = useState(true)
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)

  const isSpecialtyCategory = (category: string): boolean => {
    if (
      !user?.shop?.categories ||
      !Array.isArray(user.shop.categories) ||
      user.shop.categories.length === 0
    ) {
      return false
    }

    const userSpecialties = user.shop.categories
    const specialtyKeywords = getSpecialtyCategories(userSpecialties)

    const directMatch = userSpecialties.some(
      (specialty) =>
        specialty &&
        (category.includes(specialty) || specialty.includes(category))
    )

    const keywordMatch = specialtyKeywords.some(
      (keyword) =>
        keyword && (category.includes(keyword) || keyword.includes(category))
    )

    return directMatch || keywordMatch
  }

  const isActive = (slugOrId: string) =>
    pathname?.startsWith(`/${countryCode}/category/${slugOrId}`)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--color-header-border)] bg-[var(--color-header-background)] text-[var(--color-header-foreground)] md:hidden">
      {/* 상단: 메뉴 + 검색 + 알림 */}
      <div className="flex h-14 items-center gap-2 px-[8px]">
        {/* 좌측: 햄버거 메뉴 */}
        <div className="flex-shrink-0">
          <button
            onClick={() => setIsCategoryOpen(true)}
            className="flex flex-col items-center gap-1 p-2 text-gray-600 transition-colors"
            aria-haspopup="menu"
            aria-expanded={isCategoryOpen}
            aria-label="카테고리 열기"
          >
            <Menu className="h-6 w-6 text-white" />
          </button>
          <CategorySheet
            countryCode={countryCode}
            isOpen={isCategoryOpen}
            onClose={() => setIsCategoryOpen(false)}
          />
        </div>

        {/* 중앙: 검색 인풋 */}
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="아몬드영에서 검색하세요"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className={`w-full rounded-md bg-[var(--color-background)] px-4 py-2 pr-10 text-base text-[var(--color-foreground)] transition-all outline-none placeholder:text-[var(--color-muted-foreground)] ${
              isSearchFocused ? "ring-2 ring-[var(--color-primary)]" : ""
            }`}
          />
          <button
            className="absolute top-1/2 right-3 -translate-y-1/2 transform"
            aria-label="검색"
          >
            <Search className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        {/* 우측: 알림 */}
        <div className="flex flex-shrink-0 items-center gap-2 px-2">
          <button
            className="relative flex flex-col items-center gap-2 text-white"
            aria-label="알림"
          >
            <div className="relative">
              <Bell className="h-7 w-7" strokeWidth={2} />
              {showNotification && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-yellow-300" />
              )}
            </div>
          </button>
        </div>
      </div>

      {/* 하단: 카테고리 가로 스크롤 */}
      <div className="scrollbar-hide overflow-x-auto px-4 py-2">
        <div className="flex items-center gap-4 text-sm text-white/50">
          <Link
            href={`/${countryCode}`}
            className={`flex-shrink-0 py-1 text-base font-semibold hover:text-white ${pathname === `/${countryCode}` ? "text-white underline underline-offset-17" : "text-white/50 hover:text-white"}`}
          >
            홈
          </Link>

          {topCategories.map((cat) => {
            const slugOrId = cat.slug || cat.id
            const active = isActive(slugOrId)

            return (
              <Link
                key={cat.id}
                href={`/${countryCode}/category/${slugOrId}`}
                className={`flex-shrink-0 text-base font-semibold ${
                  active
                    ? "text-white underline underline-offset-17"
                    : isSpecialtyCategory(cat.name)
                      ? "text-yellow-30 font-bold"
                      : "text-white/50 hover:text-white"
                }`}
              >
                {cat.name}
              </Link>
            )
          })}
        </div>
      </div>

      {/* 장바구니 Sheet */}
      <CartSheet
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={[]}
      />
    </header>
  )
}
