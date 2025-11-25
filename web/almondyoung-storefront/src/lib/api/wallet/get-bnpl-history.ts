"use client"

import { clientApi } from "../client-api"
import { WALLET_SERVICE_BASE_URL } from "../api.config"

export type PaymentStatus = "WAITING" | "COMPLETED" | "CANCELLED"

export interface BnplEvent {
    id: string
    eventType: string
    eventCategory: string
    amount: number
    status: string
    createdAt: string
    title?: string
}

export interface BnplHistoryResponse {
    year?: number
    month?: number
    totalAmount: number
    events: BnplEvent[]
}

/**
 * Get BNPL history (client-side only)
 * - With year/month: fetches specific month's history
 * - Without params: fetches all history (for MVP)
 */
export async function getBnplHistory(params?: {
    year?: number
    month?: number
}): Promise<BnplHistoryResponse> {
    const queryParams = new URLSearchParams()

    if (params?.year) queryParams.append("year", params.year.toString())
    if (params?.month) queryParams.append("month", params.month.toString())

    const url = `${WALLET_SERVICE_BASE_URL}/payments/bnpl/history${queryParams.toString() ? `?${queryParams}` : ""
        }`

    return clientApi<BnplHistoryResponse>(url)
}
