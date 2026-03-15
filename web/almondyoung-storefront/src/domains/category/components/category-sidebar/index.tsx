"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { ChevronRight, ChevronDown } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"

interface CategorySidebarProps {
  categories: StoreProductCategoryTree[]
}

export function CategorySidebar({ categories }: CategorySidebarProps) {
  const pathname = usePathname()
  // /kr/category/handle 또는 /kr/category/parent/child 에서 마지막 segment 추출
  const segments = pathname.split("/").filter(Boolean)
  const categoryIndex = segments.indexOf("category")
  const currentHandle =
    categoryIndex !== -1 && segments.length > categoryIndex + 1
      ? segments[segments.length - 1]
      : undefined

  return (
    <nav className="border-border w-full rounded-2xl border p-6 px-7 py-10 font-['Pretendard']">
      <h2 className="self-stretch text-lg font-bold text-stone-900">
        카테고리
      </h2>
      <ul className="mt-2 pl-4">
        {categories.map((category) => (
          <CategoryItem
            key={category.id}
            category={category}
            currentHandle={currentHandle}
            depth={0}
          />
        ))}
      </ul>
    </nav>
  )
}

interface CategoryItemProps {
  category: StoreProductCategoryTree
  currentHandle?: string
  depth: number
}

function CategoryItem({ category, currentHandle, depth }: CategoryItemProps) {
  const hasChildren =
    category.category_children && category.category_children.length > 0
  const isActive = currentHandle === category.handle
  const isParentOfActive =
    hasChildren && isActiveParent(category, currentHandle)

  const [isOpen, setIsOpen] = useState(isParentOfActive)

  const paddingLeft = depth > 0 ? depth * 20 : 0

  if (!hasChildren) {
    return (
      <li>
        <LocalizedClientLink
          href={`/category/${category.handle}`}
          className={cn(
            "block py-3 transition-colors hover:text-primary",
            depth === 0
              ? "text-base text-foreground"
              : "text-sm text-muted-foreground",
            isActive && "font-medium text-primary"
          )}
          style={{ paddingLeft }}
        >
          {category.name}
        </LocalizedClientLink>
      </li>
    )
  }

  return (
    <li>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          className="flex items-center justify-between"
          style={{ paddingLeft }}
        >
          <LocalizedClientLink
            href={`/category/${category.handle}`}
            onClick={() => setIsOpen(true)}
            className={cn(
              "flex-1 py-3 transition-colors hover:text-primary",
              depth === 0
                ? "text-base text-foreground"
                : "text-sm text-muted-foreground",
              (isActive || isParentOfActive) && "font-medium text-primary"
            )}
          >
            {category.name}
          </LocalizedClientLink>
          <CollapsibleTrigger asChild>
            <button
              className="flex h-7 w-7 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              aria-label={isOpen ? "접기" : "펼치기"}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <ul>
            {category.category_children?.map((child) => (
              <CategoryItem
                key={child.id}
                category={child}
                currentHandle={currentHandle}
                depth={depth + 1}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function isActiveParent(
  category: StoreProductCategoryTree,
  currentHandle?: string
): boolean {
  if (!currentHandle || !category.category_children) return false

  for (const child of category.category_children) {
    if (child.handle === currentHandle) return true
    if (isActiveParent(child, currentHandle)) return true
  }

  return false
}
