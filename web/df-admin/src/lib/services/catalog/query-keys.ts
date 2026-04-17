import type { ProductsQuery } from "@/lib/types/catalog"

export const catalogKeys = {
  products: {
    all: ["products"] as const,
    list: (query: ProductsQuery) => [...catalogKeys.products.all, "list", query] as const,
    drafts: (query: ProductsQuery) => [...catalogKeys.products.all, "drafts", query] as const,
    detail: (id: string) => [...catalogKeys.products.all, id] as const,
  },
  versions: {
    all: ["versions"] as const,
    list: (masterId: string) => [...catalogKeys.versions.all, masterId] as const,
    detail: (masterId: string, versionId: string) =>
      [...catalogKeys.versions.all, masterId, versionId] as const,
  },
  categories: {
    all: ["categories"] as const,
    tree: (maxDepth?: number) => [...catalogKeys.categories.all, "tree", maxDepth] as const,
    detail: (id: string) => [...catalogKeys.categories.all, id] as const,
  },
  tags: {
    all: ["tags"] as const,
    groups: (isActive?: boolean) => [...catalogKeys.tags.all, "groups", isActive] as const,
    group: (id: string) => [...catalogKeys.tags.all, id] as const,
  },
}
