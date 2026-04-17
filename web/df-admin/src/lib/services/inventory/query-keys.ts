import type {
  DeletedSkuQuery,
  SkuAdvancedQuery,
} from "@/lib/types/inventory"

export const inventoryKeys = {
  skus: {
    all: ["inventory", "skus"] as const,
    list: (query: SkuAdvancedQuery) =>
      [...inventoryKeys.skus.all, "list", query] as const,
    deleted: (query: DeletedSkuQuery) =>
      [...inventoryKeys.skus.all, "deleted", query] as const,
    detail: (id: string) => [...inventoryKeys.skus.all, id] as const,
    stockSummary: (id: string) =>
      [...inventoryKeys.skus.all, id, "stock-summary"] as const,
  },
}
