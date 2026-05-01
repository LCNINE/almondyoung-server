import * as React from "react"
import type { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

interface CategoryBreadcrumbProps {
  category: HttpTypes.StoreProductCategory
}

export function CategoryBreadcrumb({ category }: CategoryBreadcrumbProps) {
  // 브레드크럼 데이터 생성 (부모 → 현재 카테고리 순서)
  const items: { name: string; handle: string }[] = []
  let current: HttpTypes.StoreProductCategory | null | undefined = category
  while (current) {
    items.unshift({ name: current.name, handle: current.handle })
    current = current.parent_category
  }

  if (items.length === 0) {
    return null
  }

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <LocalizedClientLink href="/">홈</LocalizedClientLink>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const href = `/category/${items
            .slice(0, index + 1)
            .map((i) => i.handle)
            .join("/")}`

          return (
            <React.Fragment key={item.handle}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{item.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <LocalizedClientLink href={href}>{item.name}</LocalizedClientLink>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
