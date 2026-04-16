import { client } from "../client"
import type {
  PaginatedResponse,
  ProductDto,
  ProductsQuery,
  ProductSummaryDto,
} from "@/lib/types/catalog"

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value))
    }
  })
  return params.toString()
}

export const productsApi = {
  list: async (
    query: ProductsQuery = {},
  ): Promise<PaginatedResponse<ProductSummaryDto>> => {
    const qs = buildQueryString(query as Record<string, unknown>)
    const response = await client.get(`/masters${qs ? `?${qs}` : ""}`)
    return response.data
  },

  get: async (id: string): Promise<ProductDto> => {
    const response = await client.get(`/masters/${id}`)
    return response.data
  },

  create: async (): Promise<ProductDto> => {
    const response = await client.post("/masters")
    return response.data
  },

  delete: async (
    id: string,
  ): Promise<{ success: boolean; message: string }> => {
    const response = await client.delete(`/masters/${id}`)
    return response.data
  },

  restore: async (
    id: string,
  ): Promise<{ success: boolean; message: string }> => {
    const response = await client.post(`/masters/${id}/restore`)
    return response.data
  },

  unpublish: async (
    id: string,
  ): Promise<{ success: boolean; message: string }> => {
    const response = await client.patch(`/masters/${id}/unpublish`)
    return response.data
  },

  bulkDelete: async (dto: { masterIds: string[] }) => {
    const response = await client.post("/masters/bulk/delete", dto)
    return response.data
  },
}
