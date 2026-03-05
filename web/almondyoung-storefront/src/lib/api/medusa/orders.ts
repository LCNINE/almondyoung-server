"use server"

import { sdk } from "@/lib/config/medusa"
import { HttpTypes, OrderStatus } from "@medusajs/types"
import { handleMedusaAuthError } from "./auth-utils"
import { getAuthHeaders, getCacheOptions } from "../../data/cookies"

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
}): Promise<HttpTypes.StoreOrderListResponse | null> {
  const filters: HttpTypes.StoreOrderFilters = {
    fields:
      "id,display_id,status,fulfillment_status,payment_status,created_at,updated_at,total,currency_code,*items,*items.variant,*items.variant.product",
    order: "-created_at",
  }

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
  if (!("authorization" in authHeaders)) return null

  const headers = { ...authHeaders }

  try {
    const res = await sdk.store.order.list(filters, headers)
    // res: HttpTypes.StoreOrderListResponse
    return res
  } catch (error) {
    await handleMedusaAuthError(error)
    console.error("getOrders error:", error)
    return null
  }
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

export async function captureOrderPayment(
  orderId: string
): Promise<{ success: boolean; message?: string }> {
  const authHeaders = await getAuthHeaders()
  if (!("authorization" in authHeaders)) {
    return {
      success: false,
      message: "로그인이 필요합니다.",
    }
  }

  const headers = {
    ...authHeaders,
  }

  const getErrorStatus = (error: any): number | undefined =>
    error?.status ?? error?.response?.status

  try {
    await sdk.client.fetch(`/store/orders/${orderId}/confirm-purchase`, {
      method: "POST",
      headers,
    })

    return { success: true }
  } catch (error: any) {
    const status = getErrorStatus(error)

    // 인증 만료로 인한 401일 때만 로그인 리다이렉트 처리
    if (status === 401) {
      await handleMedusaAuthError(error)
    }

    const message =
      status === 403 || status === 404 || status === 405 || status === 501
        ? "구매확정 기능을 처리할 수 없습니다. 잠시 후 다시 시도해주세요."
        :
      error?.message ||
      error?.response?.data?.message ||
      "구매확정에 실패했습니다. 잠시 후 다시 시도해주세요."

    console.error("captureOrderPayment(store) error:", error)
    return {
      success: false,
      message,
    }
  }
}

export const listOrders = async (
  limit: number = 10,
  offset: number = 0,
  filters?: Record<string, any>
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("orders")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreOrderListResponse>(`/store/orders`, {
      method: "GET",
      query: {
        limit,
        offset,
        order: "-created_at",
        fields: "*items,+items.metadata,*items.variant,*items.product",
        ...filters,
      },
      headers,
      next,
      cache: "force-cache",
    })
    .then(({ orders }) => orders)
    .catch(async (error) => {
      await handleMedusaAuthError(error)
      console.error("listOrders error:", error)
      return null
    })
}
