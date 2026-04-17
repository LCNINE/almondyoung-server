import { client } from "../client"
import type {
  MatchingPriority,
  MatchingStrategy,
  OrderLineQuery,
  OrderLinesResponse,
  ResolveMatchingDto,
  StockPolicyDto,
} from "@/lib/types/matching"

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value))
    }
  })
  return params.toString()
}

export const orderLinesApi = {
  list: async (query: OrderLineQuery = {}): Promise<OrderLinesResponse> => {
    const qs = buildQueryString(query as Record<string, unknown>)
    const res = await client.get(
      `/matchings/order-lines${qs ? `?${qs}` : ""}`,
    )
    return res.data
  },

  resolve: async (matchingId: string, dto: ResolveMatchingDto) => {
    const res = await client.patch(`/matchings/${matchingId}/resolve`, dto)
    return res.data
  },

  setPriority: async (matchingId: string, priority: MatchingPriority) => {
    const res = await client.patch(`/matchings/${matchingId}/priority`, {
      priority,
    })
    return res.data
  },

  changeStrategy: async (matchingId: string, strategy: MatchingStrategy) => {
    const res = await client.patch(`/matchings/${matchingId}/strategy`, {
      strategy,
    })
    return res.data
  },

  updateStockPolicy: async (matchingId: string, policy: StockPolicyDto) => {
    const res = await client.patch(
      `/matchings/${matchingId}/stock-policy`,
      policy,
    )
    return res.data
  },
}
