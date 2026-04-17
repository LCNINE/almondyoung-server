import type { OrderLineQuery } from "@/lib/types/matching"

export const matchingKeys = {
  orderLines: {
    all: ["matching", "order-lines"] as const,
    list: (query: OrderLineQuery) =>
      [...matchingKeys.orderLines.all, "list", query] as const,
  },
  variant: {
    all: ["matching", "variant"] as const,
    byVariant: (variantId: string) =>
      [...matchingKeys.variant.all, variantId] as const,
    stockPolicy: (variantId: string) =>
      [...matchingKeys.variant.all, variantId, "stock-policy"] as const,
  },
  masters: {
    all: ["matching", "masters"] as const,
    batchStats: (masterIds: string[]) =>
      [...matchingKeys.masters.all, "batch-stats", [...masterIds].sort()] as const,
  },
}
