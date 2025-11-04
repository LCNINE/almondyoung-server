"use client"

import { CategorySheet } from "@components/category/categorySheet"
import { useCategories } from "@lib/providers/category-provider" // ★ 전역 Provider 훅
import type { PimCategory } from "@lib/types/dto/pim"
import { UserBasicInfo } from "@lib/types/ui/user"
import { Bell, ChevronDown, Menu, Search } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname, useRouter } from "next/navigation"
import React, { useMemo, useState } from "react"
import CartSheet from "../../../cart/cart-sheet"

// 기본 카테고리 (서버가 없을 때 사용)
const DEFAULT_CATEGORIES: PimCategory[] = [
  {
    id: "hair",
    name: "헤어",
    slug: "hair",
    children: [],
    parent: null,
    path: "/hair",
    level: 1,
    sortOrder: 1,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "semi",
    name: "반영구",
    slug: "semi",
    children: [],
    parent: null,
    path: "/semi",
    level: 1,
    sortOrder: 2,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "nail",
    name: "네일",
    slug: "nail",
    children: [],
    parent: null,
    path: "/nail",
    level: 1,
    sortOrder: 3,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "lash",
    name: "속눈썹",
    slug: "lash",
    children: [],
    parent: null,
    path: "/lash",
    level: 1,
    sortOrder: 4,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "skin",
    name: "피부미용",
    slug: "skin",
    children: [],
    parent: null,
    path: "/skin",
    level: 1,
    sortOrder: 5,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "waxing",
    name: "왁싱",
    slug: "waxing",
    children: [],
    parent: null,
    path: "/waxing",
    level: 1,
    sortOrder: 6,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "tattoo",
    name: "타투",
    slug: "tattoo",
    children: [],
    parent: null,
    path: "/tattoo",
    level: 1,
    sortOrder: 7,
    description: null,
    isActive: true,
    parentId: null,
  },
  {
    id: "makeup",
    name: "메이크업",
    slug: "makeup",
    children: [],
    parent: null,
    path: "/makeup",
    level: 1,
    sortOrder: 8,
    description: null,
    isActive: true,
    parentId: null,
  },
]

// 사용자 전문 분야 하이라이트용
const getSpecialtyCategories = (
  specialties: { id: string; name: string }[]
): string[] => {
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

  // 사용자의 전문분야 배열에서 매칭되는 키워드들을 찾아서 반환
  const result: string[] = []
  specialties.forEach((specialty) => {
    const keywords = map[specialty.name] || []
    result.push(...keywords)
  })

  return result
}

export const MobileHeader: React.FC<{
  title?: string
  user: UserBasicInfo | null | undefined
  showBack?: boolean
  showSearch?: boolean
  showCart?: boolean
}> = ({
  title = null,
  user,
  showBack = false,
  showSearch = true,
  showCart = true,
}) => {
  const pathname = usePathname()
  const router = useRouter()
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const { categories } = useCategories() // ★ 서버 주입 카테고리 사용

  // 상단 노출용(최대 7개)
  // 카테고리가 없으면 기본 카테고리 사용
  const topCategories: PimCategory[] = useMemo(
    () =>
      Array.isArray(categories) && categories.length > 0
        ? categories.slice(0, 8)
        : DEFAULT_CATEGORIES,
    [categories]
  )

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

    // 사용자의 전문분야와 직접 매칭
    const userSpecialties = user.shop.categories
    const specialtyKeywords = getSpecialtyCategories(userSpecialties)

    // 1. 사용자 전문분야와 직접 매칭 (name으로 비교)
    const directMatch = userSpecialties.some(
      (specialty) =>
        specialty?.name &&
        (category.includes(specialty.name) || specialty.name.includes(category))
    )

    // 2. 키워드와 매칭
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
      <div className="flex h-14 items-center gap-2 px-[8px]">
        {/* 좌측 메뉴 / 뒤로가기 */}
        <div className="flex-shrink-0">
          {showBack ? (
            <button
              className="p-1"
              onClick={() => router.back()}
              aria-label="뒤로가기"
            >
              <ChevronDown className="h-6 w-6 rotate-90 text-white" />
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* 검색 인풋 */}
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
          {showSearch && (
            <button
              className="absolute top-1/2 right-3 -translate-y-1/2 transform"
              aria-label="검색"
            >
              <Search className="h-5 w-5 text-gray-400" />
            </button>
          )}
        </div>

        {/* 우측 아이콘 */}
        <div className="flex flex-shrink-0 items-center gap-2 px-2">
          {/* 알림 */}
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
            <span className="hidden text-xs font-medium lg:block lg:text-sm">
              알림
            </span>
          </button>
        </div>
      </div>

      {/* 카테고리 가로 스크롤 */}
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

      {/* 장바구니 Sheet (향후 연결) */}
      <CartSheet
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={[]}
      />
    </header>
  )
}
