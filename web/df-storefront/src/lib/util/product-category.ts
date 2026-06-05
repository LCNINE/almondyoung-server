import type { HttpTypes } from "@medusajs/types"

type CategoryWithChildren = Pick<HttpTypes.StoreProductCategory, "id"> & {
  category_children?: CategoryWithChildren[] | null
}

export function getCategoryIdsWithDescendants(
  category: CategoryWithChildren
): string[] {
  return [
    category.id,
    ...(category.category_children ?? []).flatMap((child) =>
      getCategoryIdsWithDescendants(child)
    ),
  ]
}
