"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders } from "@/lib/data/cookies"
import { HttpTypes, OrderStatus } from "@medusajs/types"
import { handleMedusaAuthError } from "./auth-utils"

export interface MedusaOrder {
  id: string
  display_id: number
  status: string
  fulfillment_status: string
  payment_status: string
  created_at: string
  updated_at: string
  total: number
  items: Array<{
    id: string
    title: string
    thumbnail?: string
    quantity: number
    variant?: {
      id: string
      title: string
      product_id?: string
      product?: {
        id: string
        title: string
        thumbnail?: string
      }
    }
    product_id?: string
  }>
}

export interface MedusaOrdersResponse {
  orders: MedusaOrder[]
  count: number
  offset: number
  limit: number
}

// Medusa 주문 목록 조회
export async function getOrders(params?: {
  limit?: number
  offset?: number
  status?: OrderStatus | OrderStatus[]
}): Promise<HttpTypes.StoreOrderListResponse | null | undefined> {
  const filters: HttpTypes.StoreOrderFilters = {}

  if (typeof params?.limit === "number") {
    filters.limit = params.limit
  }

  if (typeof params?.offset === "number") {
    filters.offset = params.offset
  }

  if (params?.status) {
    filters.status = params.status
  }

  const authHeaders = await getAuthHeaders()

  if (!authHeaders) return null

  const headers = {
    ...authHeaders,
  }

  await sdk.store.order
    .list(filters, headers)
    .then(({ orders, count, offset, limit }) => {
      return {
        orders,
        count,
        offset,
        limit,
      }
    })
    .catch(async (error) => {
      await handleMedusaAuthError(error)
      console.error("getOrders error:", error)
      return null
    })
}

// Medusa 주문 상세 조회
export async function getOrder(
  orderId: string
): Promise<HttpTypes.StoreOrder | null> {
  const authHeaders = await getAuthHeaders()

  if (!authHeaders) return null

  const headers = {
    ...authHeaders,
  }

  return await sdk.store.order
    .retrieve(orderId, {}, headers)
    .then(({ order }) => order)
    .catch(async (error) => {
      await handleMedusaAuthError(error)
      console.error("getOrder error:", error)
      return null
    })
}
