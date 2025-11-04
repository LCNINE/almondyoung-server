// src/components/category/categorySheet.tsx
"use client"

import React, { useRef, useCallback, useState, useEffect } from "react"
import { X, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCategories } from "@lib/providers/category-provider"
import type { PimCategory } from "@lib/types/dto/pim"
import ErrorState from "@components/common/components/error-state"
import LoadingState from "@components/common/components/loading-state"

interface CategorySheetProps {
  isOpen: boolean
  onClose: () => void
  isDropdown?: boolean
  topOffset?: number
  onHoverIn?: () => void
  onHoverOut?: () => void
  /** 선택: 서버나 상위에서 직접 주입하고 싶을 때 */
  categories?: PimCategory[]
  countryCode: string
}

export const CategorySheet: React.FC<CategorySheetProps> = ({
  isOpen,
  onClose,
  isDropdown = false,
  topOffset = 0,
  onHoverIn,
  onHoverOut,
  categories: categoriesProp,
  countryCode,
}) => {
  const router = useRouter()
  const { categories: ctxCategories, isRefreshing } = useCategories()
  const [activeCategory, setActiveCategory] = useState<string>("")
  const [error, setError] = useState<null | {
    type:
      | "NETWORK_ERROR"
      | "TIMEOUT_ERROR"
      | "SERVER_ERROR"
      | "CLIENT_ERROR"
      | "UNKNOWN_ERROR"
    message: string
  }>(null)

  // 우선순위: props.categories > Provider.categories (서버 데이터 그대로 사용)
  const categories =
    categoriesProp && categoriesProp.length ? categoriesProp : ctxCategories

  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const isScrollingRef = useRef(false)

  const handleCategoryNavigation = (category: PimCategory) => {
    const path = category.path || category.slug
    if (path) {
      router.push(`/${countryCode}/${path}`)
      onClose()
    }
  }
  const handleSubCategoryClick = (subCategoryId: string) => {
    router.push(`/${countryCode}/category/sub/${subCategoryId}`)
    onClose()
  }

  const handleCategoryClick = (categoryId: string) => {
    setActiveCategory(categoryId)
    isScrollingRef.current = true
    const section = sectionRefs.current[categoryId]
    if (section && contentRef.current) {
      contentRef.current.scrollTo({
        top: section.offsetTop - 20,
        behavior: "smooth",
      })
      setTimeout(() => (isScrollingRef.current = false), 500)
    }
  }

  const handleScroll = useCallback(() => {
    if (isScrollingRef.current) return
    const scrollTop = contentRef.current?.scrollTop || 0
    let current = activeCategory
    for (const c of categories) {
      const section = sectionRefs.current[c.id]
      if (section) {
        const rect = section.getBoundingClientRect()
        const container = contentRef.current?.getBoundingClientRect()
        if (!container) continue
        const inView =
          rect.top <= container.top + 100 && rect.bottom >= container.top + 100
        if (inView) {
          current = c.id
          break
        }
      }
    }
    if (current !== activeCategory) setActiveCategory(current)
  }, [activeCategory, categories])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.addEventListener("scroll", handleScroll)
    return () => el.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  if (!isOpen) return null

  // 에러 케이스 (필요 시 외부에서 set 가능하도록 확장)
  if (error) {
    return (
      <div
        className="absolute inset-x-0 z-[1000]"
        style={{ top: 0 }}
        onMouseEnter={onHoverIn}
        onMouseLeave={() => {
          setActiveCategory("")
          onHoverOut?.()
        }}
        role="menu"
        aria-label="카테고리"
      >
        <div className="mx-auto w-full max-w-[1360px] px-[40px]">
          <div className="rounded-lg bg-white p-6 shadow-xl">
            <ErrorState
              errorType={error.type}
              message={error.message}
              onRetry={() => setError(null)}
              isLoading={isRefreshing}
              className="py-8"
            />
          </div>
        </div>
      </div>
    )
  }

  // 로딩/빈 데이터 처리
  const isLoading = isRefreshing && categories.length === 0
  if (isLoading) {
    return (
      <div
        className="absolute inset-x-0 z-[1000]"
        style={{ top: 0 }}
        onMouseEnter={onHoverIn}
        onMouseLeave={() => {
          setActiveCategory("")
          onHoverOut?.()
        }}
        role="menu"
        aria-label="카테고리"
      >
        <div className="mx-auto w-full max-w-[1360px] px-[40px]">
          <div className="bg-background rounded-lg p-6 shadow-xl">
            <LoadingState
              message="카테고리를 불러오는 중..."
              className="py-8"
            />
          </div>
        </div>
      </div>
    )
  }

  // === 드롭다운 형태 (데스크톱) ===
  if (isDropdown) {
    return (
      <div
        className="absolute inset-x-0 z-[1000]"
        style={{ top: 0 }}
        onMouseEnter={onHoverIn}
        onMouseLeave={() => {
          setActiveCategory("")
          onHoverOut?.()
        }}
        role="menu"
        aria-label="카테고리"
      >
        <div className="mx-auto w-full max-w-[1360px] px-[40px]">
          <div className="flex min-h-[720px] overflow-visible">
            {/* 왼쪽 대분류 */}
            <div className="bg-background w-[220px] shrink-0 overflow-y-auto shadow-xl">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleCategoryNavigation(c)}
                  onMouseEnter={() => setActiveCategory(c.id)}
                  className={`font-base flex w-full items-center px-4 py-3 text-left text-sm transition-colors ${activeCategory === c.id ? "bg-muted text-foreground font-bold" : "bg-background text-gray-40 hover:bg-muted"} ${c.children && c.children.length > 0 ? "justify-between" : "justify-start"}`}
                >
                  <span className="truncate">{c.name}</span>
                  {c.children && c.children.length > 0 && (
                    <ChevronRight
                      size={14}
                      className={`ml-2 ${activeCategory === c.id ? "text-foreground" : "text-gray-40"}`}
                    />
                  )}
                </button>
              ))}
              <button
                onClick={() => {
                  router.push(`/${countryCode}/best`)
                  onClose()
                }}
                onMouseEnter={() => setActiveCategory("best")}
                className={`font-base flex w-full items-center px-4 py-3 text-left text-sm transition-colors ${
                  activeCategory === "best"
                    ? "bg-background text-foreground font-bold"
                    : "bg-background text-gray-40 hover:bg-muted"
                }`}
              >
                베스트
              </button>
            </div>

            {/* 오른쪽 서브 */}
            {activeCategory &&
              (() => {
                const activeCategoryData = categories.find(
                  (x) => x.id === activeCategory
                )
                return (
                  activeCategoryData?.children &&
                  activeCategoryData.children.length > 0
                )
              })() && (
                <div
                  className="bg-background w-[400px] translate-x-0 overflow-y-auto px-6 py-5 opacity-100 shadow-xl transition-all duration-300"
                  onMouseEnter={() => setActiveCategory(activeCategory)}
                  onMouseLeave={() => setActiveCategory("")}
                >
                  <div className="mb-4 flex items-center gap-2">
                    <span className="text-foreground text-lg font-bold">
                      {categories.find((x) => x.id === activeCategory)?.name}
                    </span>
                    <ChevronRight size={16} className="text-gray-40" />
                  </div>

                  <div className="grid grid-cols-3 gap-4 pb-6">
                    {(
                      categories.find((x) => x.id === activeCategory)
                        ?.children ?? []
                    ).map((sub) => (
                      <div
                        key={sub.id}
                        className="flex cursor-pointer flex-col items-center gap-2 p-2 hover:-translate-y-1 hover:font-bold"
                        onClick={() => handleSubCategoryClick(sub.id)}
                      >
                        <div className="overflow-hidden">
                          {sub.imageUrl && (
                            <img
                              src={sub.imageUrl}
                              alt={sub.name}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <span className="text-center text-sm leading-tight">
                          {sub.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    )
  }

  // === 시트 형태 (모바일) ===
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute top-0 left-0 flex h-full w-full transform flex-col bg-white transition-transform duration-800 ease-in-out"
        style={{ maxWidth: "375px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">카테고리</h2>
              <button onClick={onClose} className="p-1" aria-label="닫기">
                <X size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* 왼쪽 대분류 */}
          <div className="w-[110px] overflow-y-auto border-r border-gray-200 bg-white">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => handleCategoryClick(c.id)}
                className={`w-full px-[15px] py-[15px] text-left text-sm font-medium transition-colors ${
                  activeCategory === c.id
                    ? "bg-white text-black"
                    : "bg-[#f8f8f8] text-[#757575]"
                }`}
              >
                <span className="text-[14px] whitespace-nowrap">{c.name}</span>
              </button>
            ))}
          </div>

          {/* 오른쪽 서브 */}
          <div ref={contentRef} className="flex-1 overflow-y-auto px-4 pb-6">
            {categories.map((c) => (
              <div
                key={c.id}
                ref={(el) => {
                  sectionRefs.current[c.id] = el
                }}
                className="pt-5"
              >
                <div className="mb-4 flex items-center gap-1">
                  <span className="text-xs font-bold">{c.name}</span>
                  <ChevronRight size={14} className="text-gray-400" />
                </div>

                <div className="grid grid-cols-3 gap-x-3 gap-y-4 border-b border-gray-200 pb-6">
                  {(c.children ?? []).map((sub) => (
                    <button
                      key={sub.id}
                      className="flex flex-col items-center gap-1"
                      onClick={() => handleSubCategoryClick(sub.id)}
                    >
                      <div className="bg-muted h-[55px] w-[55px] overflow-hidden rounded-full">
                        {sub.imageUrl && (
                          <img
                            src={sub.imageUrl}
                            alt={sub.name}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <span className="w-full text-center text-xs leading-[15px]">
                        {sub.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {categories.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">
                표시할 카테고리가 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
