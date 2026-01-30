"use server"

import { api } from "../api"

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
    status?: string
}): Promise<MedusaOrdersResponse> {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append("limit", params.limit.toString())
    if (params?.offset) queryParams.append("offset", params.offset.toString())
    if (params?.status) queryParams.append("status", params.status)

    const result = await api<MedusaOrdersResponse>(
        "medusa",
        `/store/customers/me/orders${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
        {
            method: "GET",
            withAuth: true,
            cache: "no-store",
        }
    )

    return result
}

// Medusa 주문 상세 조회
export async function getOrder(orderId: string) {
    const result = await api("medusa", `/store/orders/${orderId}`, {
        method: "GET",
        withAuth: true,
        cache: "no-store",
    })

    return result
}

