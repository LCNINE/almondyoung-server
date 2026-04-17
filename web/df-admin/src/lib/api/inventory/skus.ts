import { client } from "../client"
import type {
  AddBarcodeDto,
  BarcodeDto,
  CreateSkuDto,
  DeletedSkuQuery,
  SkuAdvancedQuery,
  SkuDto,
  SkuOffsetPaginatedResponse,
  SkuStockSummaryDto,
  UpdateSkuDto,
} from "@/lib/types/inventory"

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value))
    }
  })
  return params.toString()
}

export const skusApi = {
  list: async (
    query: SkuAdvancedQuery = {},
  ): Promise<SkuOffsetPaginatedResponse<SkuDto>> => {
    const qs = buildQueryString(query as Record<string, unknown>)
    const response = await client.get(
      `/inventory/skus/search/advanced${qs ? `?${qs}` : ""}`,
    )
    return response.data
  },

  listDeleted: async (
    query: DeletedSkuQuery = {},
  ): Promise<SkuOffsetPaginatedResponse<SkuDto>> => {
    const qs = buildQueryString(query as Record<string, unknown>)
    const response = await client.get(
      `/inventory/skus/deleted${qs ? `?${qs}` : ""}`,
    )
    return response.data
  },

  get: async (id: string): Promise<SkuDto> => {
    const response = await client.get(`/inventory/skus/${id}`)
    return response.data
  },

  create: async (dto: CreateSkuDto): Promise<SkuDto> => {
    const response = await client.post("/inventory/skus", dto)
    return response.data
  },

  update: async (id: string, dto: UpdateSkuDto): Promise<SkuDto> => {
    const response = await client.put(`/inventory/skus/${id}`, dto)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/inventory/skus/${id}`)
  },

  restore: async (id: string): Promise<SkuDto> => {
    const response = await client.patch(`/inventory/skus/${id}/restore`)
    return response.data
  },

  addBarcode: async (
    id: string,
    dto: AddBarcodeDto,
  ): Promise<BarcodeDto> => {
    const response = await client.post(`/inventory/skus/${id}/barcodes`, dto)
    return response.data
  },

  removeBarcode: async (id: string, barcodeId: string): Promise<void> => {
    await client.delete(`/inventory/skus/${id}/barcodes/${barcodeId}`)
  },

  stockSummary: async (id: string): Promise<SkuStockSummaryDto> => {
    const response = await client.get(`/inventory/skus/${id}/stock-summary`)
    return response.data
  },
}
