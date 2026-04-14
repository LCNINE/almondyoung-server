"use client"

import { useEffect, useState } from "react"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { MainCategoryList } from "./main-category-list"
import { SubCategoryPanel } from "./sub-category-panel"
import { MegaMenuTrigger } from "./mega-menu-trigger"

interface MegaMenuProps {
  categories: StoreProductCategoryTree[]
}

export function MegaMenu({ categories }: MegaMenuProps) {
  const [activeCategory, setActiveCategory] =
    useState<StoreProductCategoryTree | null>(categories[0] || null)

  // categories가 변경되면 activeCategory 동기화
  useEffect(() => {
    setActiveCategory(
      (prev) =>
        categories.find((category) => category.id === prev?.id) ??
        categories[0] ??
        null
    )
  }, [categories])

  const handleCategoryHover = (category: StoreProductCategoryTree) => {
    setActiveCategory(category)
  }

  if (categories.length === 0) {
    return null
  }

  return (
    <NavigationMenu className="hidden md:flex">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger className="text-muted h-10 cursor-pointer gap-2 rounded-md bg-transparent px-3">
            <MegaMenuTrigger />
          </NavigationMenuTrigger>

          <NavigationMenuContent className="left-0">
            <div className="flex w-[700px] rounded-lg bg-white shadow-xl">
              {/* 왼쪽: 메인 카테고리 목록 */}
              <MainCategoryList
                categories={categories}
                activeCategory={activeCategory}
                onCategoryHover={handleCategoryHover}
              />

              {/* 오른쪽: 서브카테고리 패널 */}
              <SubCategoryPanel category={activeCategory} />
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}
