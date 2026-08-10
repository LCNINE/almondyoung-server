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

type ProductCategory = HttpTypes.StoreProductCategory & {
  parent_category?: ProductCategory | null
}

type ProductWithCategories = HttpTypes.StoreProduct & {
  categories?: ProductCategory[] | null
}

interface ProductBreadcrumbProps {
  product: ProductWithCategories
}

function getCategoryDepth(category: ProductCategory): number {
  let depth = 0
  let current = category.parent_category

  while (current) {
    depth += 1
    current = current.parent_category
  }

  return depth
}

function getCategoryPath(category: ProductCategory): ProductCategory[] {
  const items: ProductCategory[] = []
  let current: ProductCategory | null | undefined = category

  while (current) {
    items.unshift(current)
    current = current.parent_category
  }

  return items
}

export function ProductBreadcrumb({ product }: ProductBreadcrumbProps) {
  const category = product.categories
    ?.filter((item) => item.handle)
    .sort((a, b) => getCategoryDepth(b) - getCategoryDepth(a))[0]

  const categories = category ? getCategoryPath(category) : []

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <LocalizedClientLink href="/">홈</LocalizedClientLink>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {categories.map((item, index) => {
          const href = `/category/${categories
            .slice(0, index + 1)
            .map((categoryItem) => categoryItem.handle)
            .join("/")}`

          return (
            <React.Fragment key={item.id}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <LocalizedClientLink href={href}>{item.name}</LocalizedClientLink>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}

        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="line-clamp-1 max-w-[220px] sm:max-w-[360px] xl:max-w-[420px]">
            {product.title}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
