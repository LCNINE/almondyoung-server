"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { NavigationMenuLink } from "@/components/ui/navigation-menu"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useRef, useState } from "react"

// 별도 디자인 항목으로 좌측 하단에 분리 노출할 대분류 handle.
// "브랜드관"은 카테고리(cafe24-cat-728, 이름 '브랜드')로 이동, "샵매매"는 자체 게시판(/shop-trade)으로 이동.
const BRAND_CATEGORY_HANDLE = "cafe24-cat-728"

// 메가메뉴 목록에서 아예 숨길 대분류 handle.
// - cafe24-cat-82(베스트) / cafe24-cat-498(100원 웰컴딜): 프로모성 → 목록 슬림화 위해 숨김.
// cafe24-cat-499(전체상품 보기)는 모바일 시트·카테고리 사이드바에 노출되므로 여기서도 노출한다.
const HIDDEN_CATEGORY_HANDLES = new Set(["cafe24-cat-82", "cafe24-cat-498"])

const HOVER_INTENT_MS = 20

// 리스트가 길면 잘라내고 "더보기"로 카테고리 페이지 이동
// 네일 젤 브랜드처럼 소분류가 수십 개인 경우 대응.
const MAX_LIST_ITEMS = 14

interface MegaMenuProps {
  categories: StoreProductCategoryTree[]
}

export function MegaMenu({ categories }: MegaMenuProps) {
  const t = useTranslations("header.categoryDropdown")
  // 현재 보고 있는 카테고리 경로(/{cc}/category/a/b/c)의 handle 집합.
  // hover 활성과 별개로 "지금 어느 카테고리에 있는지"를 메뉴에서 바로 보여준다.
  const pathname = usePathname() ?? ""
  const currentHandles = new Set(
    pathname.split("/category/")[1]?.split("/").filter(Boolean) ?? []
  )

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

  // 우측 큰 이미지는 대분류로 고정한다. 중분류를 훑을 때마다 이미지가 바뀌면 산만하다.
  const spotlight = l1
  const spotlightImage = l1 ? getCategoryThumbnail(l1) : null
  const spotlightHref = `/category/${l1?.handle || l1?.id}`

  return (
    <div className="flex max-h-[calc(100vh-140px)] min-h-[500px]">
      {/* ─── col1: 대분류 세로 리스트 ─── */}
      <aside className="scrollbar-hide flex w-[168px] shrink-0 flex-col overflow-y-auto py-2">
        <ul>
          {mainCategories.map((cat) => {
            const id = cat.handle || cat.id
            const icon = getCategoryThumbnail(cat)
            return (
              <li key={cat.id}>
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    prefetch={false}
                    href={`/category/${cat.handle || cat.id}`}
                    onMouseEnter={() => enterL1(id)}
                    onMouseLeave={clearTimers}
                    onFocus={() => enterL1(id)}
                    aria-current={
                      currentHandles.has(cat.handle) ? "page" : undefined
                    }
                    className={cn(
                      "flex h-[28px] items-center gap-2 pr-3 pl-4 text-[12px] leading-none transition-colors",
                      activeL1 === id
                        ? "text-primary font-semibold"
                        : currentHandles.has(cat.handle)
                          ? "text-foreground font-semibold"
                          : "hover:text-primary text-[#333]"
                    )}
                  >
                    <span className="relative h-4 w-4 shrink-0">
                      {icon && (
                        <Image
                          src={getThumbnailUrl(icon)}
                          alt=""
                          fill
                          sizes="16px"
                          className="object-contain"
                        />
                      )}
                    </span>
                    <span className="flex-1 truncate">{cat.name}</span>
                    {(cat.category_children?.length ?? 0) > 0 && (
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
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
            <NavigationMenuLink asChild>
              <LocalizedClientLink
                prefetch={false}
                href="/shop-trade"
                className="hover:text-primary flex h-[28px] items-center gap-2 pr-3 pl-4 text-[12px] leading-none font-medium text-[#333] transition-colors"
              >
                <span className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{t("shopTrade")}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
              </LocalizedClientLink>
            </NavigationMenuLink>
          </li>
          <li>
            <NavigationMenuLink asChild>
              <LocalizedClientLink
                prefetch={false}
                href={`/category/${BRAND_CATEGORY_HANDLE}`}
                className="hover:text-primary flex h-[28px] items-center gap-2 pr-3 pl-4 text-[12px] leading-none font-medium text-[#333] transition-colors"
              >
                <span className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{t("brandHall")}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
              </LocalizedClientLink>
            </NavigationMenuLink>
          </li>
        </ul>
      </aside>

      {/* ─── 우측 영역: 대분류 hover 시에만 나오는 고정폭 wrapper.
          hover 전(l1 없음)엔 col1 폭만 뜨고, hover 하면 여기가 펼쳐진다. ─── */}
      {l1 && (
        <div className="flex w-[592px] shrink-0">
          {/* ─── col2: 중분류 세로 리스트 (대분류에 하위 있을 때만) ─── */}
          {l1Children.length > 0 && (
            <aside className="w-[160px] shrink-0 overflow-y-auto border-l border-gray-100 py-2">
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
                          onFocus={() => enterL2(id)}
                          aria-current={
                            currentHandles.has(sub.handle) ? "page" : undefined
                          }
                          className={cn(
                            "flex h-[28px] items-center justify-between gap-2 px-5 text-[12px] leading-none transition-colors",
                            activeL2 === id
                              ? "text-primary font-semibold"
                              : currentHandles.has(sub.handle)
                                ? "text-foreground font-semibold"
                                : "hover:text-primary text-gray-600"
                          )}
                        >
                          <span className="truncate">{sub.name}</span>
                          {hasChildren && (
                            <ChevronRight
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
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
                    className="hover:text-primary text-primary decoration-primary block px-5 py-[7px] text-[12px] font-medium underline underline-offset-4 hover:opacity-80"
                  >
                    {t("viewMore")}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              )}
            </aside>
          )}

          {/* ─── col3: 소분류 세로 리스트 (중분류 hover + 하위 있을 때만) ─── */}
          {l2 && l2Children.length > 0 && (
            <aside className="w-[160px] shrink-0 overflow-y-auto border-l border-gray-100 py-2">
              <NavigationMenuLink asChild>
                <LocalizedClientLink
                  prefetch={false}
                  href={`/category/${l1!.handle || l1!.id}/${l2.handle || l2.id}`}
                  className="group flex items-center gap-1 px-5 py-[7px] text-[12px] font-bold text-gray-900 underline underline-offset-4"
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
                        aria-current={
                          currentHandles.has(leaf.handle) ? "page" : undefined
                        }
                        className={cn(
                          "hover:text-primary flex h-[28px] items-center truncate px-5 text-[12px] leading-none transition-colors",
                          currentHandles.has(leaf.handle)
                            ? "text-foreground font-semibold"
                            : "text-gray-600"
                        )}
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
                    className="hover:text-primary text-primary decoration-primary block px-5 py-[6px] text-[12px] font-medium underline underline-offset-4 hover:opacity-80"
                  >
                    {t("viewMore")}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              )}
            </aside>
          )}

          {/* ─── 우측 영역: hover 중인 카테고리의 큰 썸네일 ─── */}
          <div className="min-w-0 flex-1 p-4">
            {spotlight ? (
              <NavigationMenuLink asChild>
                <LocalizedClientLink
                  prefetch={false}
                  href={spotlightHref}
                  className="group flex h-full min-h-[380px] flex-col items-center justify-center gap-3"
                >
                  <p className="text-foreground text-lg font-bold">
                    {spotlight.name}
                  </p>
                  {spotlightImage && (
                    <div className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-white">
                      <Image
                        src={getThumbnailUrl(spotlightImage)}
                        alt={spotlight.name}
                        fill
                        sizes="320px"
                        className="object-contain transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                  )}
                </LocalizedClientLink>
              </NavigationMenuLink>
            ) : (
              <div className="h-full min-h-[380px]" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
