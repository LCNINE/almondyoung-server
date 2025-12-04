"use client"

import { Bell, Menu, ShoppingCart, User } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
// [제거] useLayoutEffect, useRef
import { useMemo, useState } from "react"
//categorysheet
import { CategorySheet } from "@components/category/categorySheet"
// [제거] Portal
//providers
import { useCategories } from "@lib/providers/category-provider"
//mock data
import { mockCartItems } from "app/data/__mocks__/user-cart-mock"
//types
import type { PimCategory } from "@lib/api/pim"
import { UserBasicInfo } from "@lib/types/ui/user"
//search input
import { SearchInput } from "./search-input"
import { useUser } from "contexts/user-context"
import { getShowOnMainCategory } from "@lib/utils/category-display-settings"

/** 트리에서 조상 경로를 찾는 유틸 */
function buildAncestors(
  categories: PimCategory[],
  match: (c: PimCategory) => boolean
): PimCategory[] {
  const stack: PimCategory[] = []
  let found: PimCategory[] | null = null

  const dfs = (node: PimCategory) => {
    if (found) return
    stack.push(node)
    if (match(node)) {
      found = [...stack]
      stack.pop()
      return
    }
    // CategoryTreeNode만 children을 가질 수 있음
    const children = "children" in node ? node.children : undefined
    if (children) {
      for (const child of children) dfs(child)
    }
    stack.pop()
  }

  for (const root of categories) dfs(root)
  return found ?? []
}

// 사용자 전문 분야별 네비 강조용
const getSpecialtyCategories = (specialties: string[]): string[] => {
  const map: Record<string, string[]> = {
    속눈썹: ["속눈썹", "속눈썹 연장", "속눈썹 펌", "속눈썹 영양제"],
    네일: ["네일", "네일아트", "네일 도구", "네일 케어"],
    피부: ["피부"],
    메이크업: ["메이크업"],
    헤어: ["헤어"],
  }

  // 사용자의 전문분야 배열에서 매칭되는 키워드들을 찾아서 반환
  const result: string[] = []
  specialties.forEach((specialty) => {
    const keywords = map[specialty] || []
    result.push(...keywords)
  })

  return result
}

export function DesktopHeader() {
  const { user } = useUser()

  const { categories } = useCategories() // ★ 전역 주입된 실데이터
  const pathname = usePathname()
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

  // [제거] headerRef, headerBottom, useLayoutEffect 로직 삭제
  // const headerRef = useRef<HTMLDivElement>(null)
  // const [headerBottom, setHeaderBottom] = useState(0)
  // useLayoutEffect(() => { ... }, [])

  // 장바구니 수(실서비스 연결 전까지 목업 유지)
  const cartItemCount = user
    ? mockCartItems.reduce((sum, item) => sum + item.quantity, 0)
    : 0

  // 카테고리 드롭다운 상태
  const [open, setOpen] = useState(false)
  const [showNotification] = useState(true)

  // 서버 데이터만 사용
  // showOnMainCategory가 true인 카테고리만 필터링하고 sortOrder 순으로 정렬
  const topLevel: PimCategory[] = useMemo(() => {
    if (!Array.isArray(categories) || categories.length === 0) {
      return []
    }

    const filtered = categories.filter((cat) => getShowOnMainCategory(cat))
    const sorted = filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    const sliced = sorted.slice(0, 8)

    return sliced
  }, [categories])

  // 전문 분야 하이라이트
  const isSpecialtyCategory = (name: string) => {
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
      (specialty: string) =>
        specialty && (name.includes(specialty) || specialty.includes(name))
    )

    // 2. 키워드와 매칭
    const keywordMatch = specialtyKeywords.some(
      (keyword) => keyword && (name.includes(keyword) || keyword.includes(name))
    )

    return directMatch || keywordMatch
  }

  // 현재 경로 활성화判定
  const isActive = (slugOrId: string) => {
    // 새 URL 구조: /category/[slug]
    const directMatch =
      pathname?.startsWith(`/${countryCode}/category/${slugOrId}`) ||
      pathname?.startsWith(`/category/${slugOrId}`)

    if (directMatch) return true

    // 서브 카테고리 경로에서 부모 카테고리 확인
    if (
      pathname?.includes("/category/") &&
      pathname?.split("/category/")[1]?.includes("/")
    ) {
      // 이미 선언된 categories 변수 사용 (조건부 Hook 호출 제거)
      // 현재 서브 카테고리 slug 추출
      const pathParts = pathname.split("/category/")[1]?.split("/")
      const subSlug = pathParts?.[1]
      if (!subSlug) return false

      // 카테고리 트리에서 해당 서브 카테고리 찾기
      const findCategory = (cats: PimCategory[]): PimCategory | null => {
        for (const cat of cats) {
          if (cat.slug === subSlug) return cat
          // CategoryTreeNode만 children을 가질 수 있음
          const children = "children" in cat ? cat.children : undefined
          if (children && children.length > 0) {
            const found = findCategory(children)
            if (found) return found
          }
        }
        return null
      }

      const currentCategory = findCategory(categories)
      if (!currentCategory) return false

      // 조상 경로에서 해당 카테고리 확인
      const ancestors = buildAncestors(
        categories,
        (c) => c.id === currentCategory.id
      )
      return ancestors.some(
        (cat) => cat.slug === slugOrId || cat.id === slugOrId
      )
    }

    return false
  }

  return (
    // [제거] ref={headerRef}
    <header className="bg-header-background hidden overflow-visible md:block">
      <div className="container mx-auto max-w-[1360px] px-[40px]">
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between py-5">
          {/* 로고 */}
          <Link href={`/${countryCode}`} className="shrink-0">
            <div className="relative h-10 w-[200px] lg:h-[45px] lg:w-[287px]">
              <Image
                src="/images/almond_white_logo.svg"
                alt="아몬드영"
                width={287}
                height={45}
                className="h-full w-full object-contain"
                priority
              />
            </div>
          </Link>

          {/* 검색바 & 유틸 메뉴 */}
          <div className="ml-8 flex max-w-3xl flex-1 items-center gap-8 overflow-visible lg:ml-12">
            {/* 검색바 */}
            <SearchInput countryCode={countryCode} />

            {/* 유틸 아이콘 */}
            <div className="flex items-center gap-6">
              {/* 장바구니 */}
              <Link
                href={`/${countryCode}/cart`}
                className="flex flex-col items-center gap-1 text-white"
              >
                <div className="relative">
                  <ShoppingCart
                    className="h-8 w-8"
                    strokeWidth={2}
                    color="white"
                  />
                  {cartItemCount > 0 && (
                    <span className="bg-yellow-30 absolute -top-2 -right-2 flex h-5 w-5 min-w-[20px] items-center justify-center rounded-full text-xs font-bold text-white">
                      {cartItemCount > 99 ? "99+" : cartItemCount}
                    </span>
                  )}
                </div>
                <span className="text-[14px]font-medium hidden lg:block">
                  장바구니
                </span>
              </Link>

              {/* 마이페이지/로그인 */}
              {user ? (
                <Link
                  href={`/${countryCode}/mypage`}
                  className="flex flex-col items-center gap-1 text-white"
                >
                  <User className="h-8 w-8" strokeWidth={2.2} color="white" />
                  <span className="hidden text-xs font-medium lg:block lg:text-sm">
                    마이
                  </span>
                </Link>
              ) : (
                <Link
                  href={`/${countryCode}/login`}
                  className="flex flex-col items-center gap-1 text-white"
                >
                  <User className="h-8 w-8" strokeWidth={2.2} color="white" />
                  <span className="hidden text-xs font-medium lg:block lg:text-sm">
                    로그인
                  </span>
                </Link>
              )}

              {/* 알림 */}
              <button className="relative flex flex-col items-center gap-1 text-white">
                <div className="relative">
                  <Bell className="h-8 w-8" strokeWidth={2} color="white" />
                  {showNotification && (
                    <span className="bg-yellow-30 absolute -top-1 -right-1 h-2 w-2 rounded-full" />
                  )}
                </div>
                <span className="hidden text-xs font-medium lg:block lg:text-sm">
                  알림
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="relative z-205 flex items-center gap-8">
          <button
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={() => setOpen((v) => !v)}
            className="py-2 text-white"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Menu className="h-8 w-8" color="white" />
          </button>

          {open && (
            <div
              className="absolute top-full right-0 left-[-50px] z-300 shadow-2xl"
              onMouseEnter={() => setOpen(true)} // 시트 위로 마우스가 가도 안 닫힘
              onMouseLeave={() => setOpen(false)} // 시트에서 마우스가 나가면 닫힘
            >
              <div className="mx-auto w-full max-w-[1360px] px-[40px]">
                <CategorySheet
                  countryCode={countryCode}
                  isOpen={open}
                  onClose={() => setOpen(false)}
                  isDropdown
                  // [제거] topOffset prop 제거
                  onHoverIn={() => setOpen(true)}
                  onHoverOut={() => setOpen(false)}
                />
              </div>
            </div>
          )}
          {/* </Portal> [제거] */}

          <nav className="flex items-center gap-5 lg:gap-7">
            <Link
              href={`/${countryCode}`}
              className={`shrink-0 font-semibold md:text-xl ${
                pathname === `/${countryCode}`
                  ? "text-white underline underline-offset-15"
                  : "text-white/50 hover:text-white"
              }`}
            >
              홈
            </Link>

            {topLevel.map((cat) => {
              const slugOrId = cat.slug || cat.id
              const active = isActive(slugOrId)

              return (
                <Link
                  key={cat.id}
                  href={`/${countryCode}/category/${slugOrId}`}
                  className={`shrink-0 font-semibold md:text-xl ${
                    active
                      ? "text-white underline underline-offset-15"
                      : isSpecialtyCategory(cat.name)
                        ? "text-yellow-30 font-bold"
                        : "text-white/50 hover:text-white"
                  }`}
                >
                  {cat.name}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </header>
  )
}
