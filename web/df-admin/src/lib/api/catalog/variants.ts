import { client } from "../client"
import type { PaginatedResponse } from "@/lib/types/catalog"

export const variantsApi = {
  listByMaster: async (
    masterId: string,
    query?: { status?: string; includePrice?: boolean; page?: number; limit?: number },
  ): Promise<PaginatedResponse<Record<string, unknown>>> => {
    const params = new URLSearchParams()
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined) params.append(k, String(v))
      })
    }
    const qs = params.toString()
    const response = await client.get(
      `/variants/masters/${masterId}${qs ? `?${qs}` : ""}`,
    )
    return response.data
  },

  update: async (id: string, dto: Record<string, unknown>) => {
    const response = await client.put(`/variants/${id}`, dto)
    return response.data
  },

  updateStatus: async (id: string, status: string) => {
    const response = await client.put(`/variants/${id}/status`, { status })
    return response.data
  },
}
