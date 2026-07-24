"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { NavigationMenuLink } from "@/components/ui/navigation-menu"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRef, useState } from "react"

// 별도 디자인 항목으로 좌측 하단에 분리 노출할 대분류 handle.
// "브랜드관"은 카테고리(cafe24-cat-728, 이름 '브랜드')로 이동, "샵매매"는 기능 준비 중.
const BRAND_CATEGORY_HANDLE = "cafe24-cat-728"

// 메가메뉴 목록에서 아예 숨길 대분류 handle.
// - cafe24-cat-499(전체상품 보기): catch-all 이라 네비게이션 목록에서 제외.
// - cafe24-cat-82(베스트) / cafe24-cat-498(100원 웰컴딜): 프로모성 → 목록 슬림화 위해 숨김.
const HIDDEN_CATEGORY_HANDLES = new Set([
  "cafe24-cat-499",
  "cafe24-cat-82",
  "cafe24-cat-498",
])

const HOVER_INTENT_MS = 20

// 리스트가 길면 잘라내고 "더보기"로 카테고리 페이지 이동
// 네일 젤 브랜드처럼 소분류가 수십 개인 경우 대응.
const MAX_LIST_ITEMS = 14

interface MegaMenuProps {
  categories: StoreProductCategoryTree[]
}

export function MegaMenu({ categories }: MegaMenuProps) {
  const t = useTranslations("header.categoryDropdown")

  // "브랜드"는 하단 특별 항목(브랜드관)으로, 숨김 대상은 목록에서 제외
  const mainCategories = categories.filter(
    (c) =>
      c.handle !== BRAND_CATEGORY_HANDLE &&
      !HIDDEN_CATEGORY_HANDLES.has(c.handle)
  )

  // 쿠팡식: 최초엔 아무것도 활성 안 됨. hover 해야 하위 목록이 뜬다.
  const [activeL1, setActiveL1] = useState("") // 대분류
  const [activeL2, setActiveL2] = useState("") // 중분류
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null)

  const enterL1 = (id: string) => {
    if (activeL1 === id) return
    if (t1.current) clearTimeout(t1.current)
    t1.current = setTimeout(() => {
      setActiveL1(id)
      setActiveL2("") // 대분류 바뀌면 중분류 선택 초기화
    }, HOVER_INTENT_MS)
  }
  const enterL2 = (id: string) => {
    if (activeL2 === id) return
    if (t2.current) clearTimeout(t2.current)
    t2.current = setTimeout(() => setActiveL2(id), HOVER_INTENT_MS)
  }
  const clearTimers = () => {
    if (t1.current) clearTimeout(t1.current)
    if (t2.current) clearTimeout(t2.current)
  }

  const l1 = mainCategories.find((c) => (c.handle || c.id) === activeL1)
  const l1Children = l1?.category_children ?? []
  const l2 = l1Children.find((c) => (c.handle || c.id) === activeL2)
  const l2Children = l2?.category_children ?? []

  return (
    <div className="flex max-h-[calc(100vh-140px)] min-h-[500px]">
      {/* ─── col1: 대분류 세로 리스트 ─── */}
      <aside className="scrollbar-hide flex w-[210px] shrink-0 flex-col overflow-y-auto py-2">
        <ul>
          {mainCategories.map((cat) => {
            const id = cat.handle || cat.id
            return (
              <li key={cat.id}>
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    prefetch={false}
                    href={`/category/${cat.handle || cat.id}`}
                    onMouseEnter={() => enterL1(id)}
                    onMouseLeave={clearTimers}
                    className={cn(
                      // 쿠팡 1뎁스 스펙: font 12px, padding-top 9px, 항목 높이 ~29px
                      "flex items-center justify-between gap-2 px-5 py-[9px] text-[12px] leading-none transition-colors",
                      activeL1 === id
                        ? "text-primary font-semibold"
                        : "hover:text-primary text-[#333]"
                    )}
                  >
                    <span className="truncate">{cat.name}</span>
                    {(cat.category_children?.length ?? 0) > 0 && (
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0",
                          activeL1 === id ? "text-primary" : "text-gray-300"
                        )}
                      />
                    )}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              </li>
            )
          })}
        </ul>

        {/* 별도 디자인 항목 (샵매매 / 브랜드관) */}
        <div className="my-2 border-t border-gray-100" />
        <ul>
          <li>
            {/* 샵매매: 기능 준비 중 → 이동 없음 */}
            <span className="flex cursor-default items-center justify-between gap-2 px-5 py-[7px] text-sm text-gray-400">
              <span>{t("shopTrade")}</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
                {t("comingSoon")}
              </span>
            </span>
          </li>
          <li>
            <NavigationMenuLink asChild>
              <LocalizedClientLink
                prefetch={false}
                href={`/category/${BRAND_CATEGORY_HANDLE}`}
                className="hover:text-primary flex items-center justify-between gap-2 px-5 py-[7px] text-sm font-medium text-gray-700 transition-colors"
              >
                <span>{t("brandHall")}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
              </LocalizedClientLink>
            </NavigationMenuLink>
          </li>
        </ul>
      </aside>

      {/* ─── 우측 영역: 대분류 hover 시에만 나오는 고정폭 wrapper.
          hover 전(l1 없음)엔 col1 폭만 뜨고, hover 하면 여기가 펼쳐진다. ─── */}
      {l1 && (
        <div className="flex w-[830px] shrink-0">
          {/* ─── col2: 중분류 세로 리스트 (대분류에 하위 있을 때만) ─── */}
          {l1Children.length > 0 && (
            <aside className="w-[210px] shrink-0 overflow-y-auto border-l border-gray-100 py-2">
              <ul>
                {l1Children.slice(0, MAX_LIST_ITEMS).map((sub) => {
                  const id = sub.handle || sub.id
                  const hasChildren = (sub.category_children?.length ?? 0) > 0
                  return (
                    <li key={sub.id}>
                      <NavigationMenuLink asChild>
                        <LocalizedClientLink
                          prefetch={false}
                          href={`/category/${l1.handle || l1.id}/${sub.handle || sub.id}`}
                          onMouseEnter={() => enterL2(id)}
                          className={cn(
                            "flex items-center justify-between gap-2 px-5 py-[7px] text-sm transition-colors",
                            activeL2 === id
                              ? "text-primary font-semibold"
                              : "hover:text-primary text-gray-600"
                          )}
                        >
                          <span className="truncate">{sub.name}</span>
                          {hasChildren && (
                            <ChevronRight
                              className={cn(
                                "h-4 w-4 shrink-0",
                                activeL2 === id
                                  ? "text-primary"
                                  : "text-gray-300"
                              )}
                            />
                          )}
                        </LocalizedClientLink>
                      </NavigationMenuLink>
                    </li>
                  )
                })}
              </ul>
              {l1Children.length > MAX_LIST_ITEMS && (
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    prefetch={false}
                    href={`/category/${l1.handle || l1.id}`}
                    className="hover:text-primary text-primary decoration-primary block px-5 py-[7px] text-sm font-medium underline underline-offset-4 hover:opacity-80"
                  >
                    {t("viewMore")}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              )}
            </aside>
          )}

          {/* ─── col3: 소분류 세로 리스트 (중분류 hover + 하위 있을 때만) ─── */}
          {l2 && l2Children.length > 0 && (
            <aside className="w-[220px] shrink-0 overflow-y-auto border-l border-gray-100 py-2">
              <NavigationMenuLink asChild>
                <LocalizedClientLink
                  prefetch={false}
                  href={`/category/${l1!.handle || l1!.id}/${l2.handle || l2.id}`}
                  className="group flex items-center gap-1 px-5 py-[7px] text-sm font-bold text-gray-900"
                >
                  <span className="truncate">{l2.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
                </LocalizedClientLink>
              </NavigationMenuLink>
              <ul>
                {l2Children.slice(0, MAX_LIST_ITEMS).map((leaf) => (
                  <li key={leaf.id}>
                    <NavigationMenuLink asChild>
                      <LocalizedClientLink
                        prefetch={false}
                        href={`/category/${l1!.handle || l1!.id}/${l2.handle || l2.id}/${leaf.handle || leaf.id}`}
                        className="hover:text-primary block truncate px-5 py-[6px] text-sm text-gray-600 transition-colors"
                      >
                        {leaf.name}
                      </LocalizedClientLink>
                    </NavigationMenuLink>
                  </li>
                ))}
              </ul>
              {l2Children.length > MAX_LIST_ITEMS && (
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    prefetch={false}
                    href={`/category/${l1!.handle || l1!.id}/${l2.handle || l2.id}`}
                    className="hover:text-primary text-primary decoration-primary block px-5 py-[6px] text-sm font-medium underline underline-offset-4 hover:opacity-80"
                  >
                    {t("viewMore")}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              )}
            </aside>
          )}

          {/* ─── 우측 영역: leaf CTA / 배너 슬롯. flex-1 로 남은 폭을 채워 전체 패널 폭을 고정(쿠팡식) ─── */}
          <div className="min-w-[280px] flex-1 p-4">
            {l1 && l1Children.length === 0 ? (
              // 대분류만 있고 중분류 없음(leaf): 중앙 CTA
              <div className="flex h-full min-h-[380px] flex-col items-center justify-center gap-4 text-center">
                <p className="text-xl font-bold text-gray-900">{l1.name}</p>
                <p className="text-sm text-gray-500">{t("leafHint")}</p>
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    prefetch={false}
                    href={`/category/${l1.handle || l1.id}`}
                    className="bg-primary hover:bg-primary/90 inline-flex items-center gap-1 rounded-full px-5 py-2 text-sm font-semibold text-white transition-colors"
                  >
                    <span>{t("viewProducts")}</span>
                    <ChevronRight className="h-4 w-4" />
                  </LocalizedClientLink>
                </NavigationMenuLink>
              </div>
            ) : (
              // 배너 슬롯 (프로모/이벤트 이미지용 예약 공간).
              // ponytail: 콘텐츠 정해지면 이 박스 안에 이미지/링크 넣으면 됨.
              <div className="h-full min-h-[380px]" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
