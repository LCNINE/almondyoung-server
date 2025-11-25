"use client"

import { clientApi } from "../client-api"
import { WALLET_SERVICE_BASE_URL } from "../api.config"

export interface BnplSummary {
    hasAccount: boolean
    creditLimit: number | null
    availableLimit: number | null
    usedAmount: number | null
    nextBillingDate: string | null
    dDay: number | null
    targetYear: number | null
    targetMonth: number | null
}

/**
 * Get BNPL summary (client-side only)
 * Calls via /api proxy which Next.js rewrites to backend
 */
export async function getBnplSummary(): Promise<BnplSummary> {
    const url = `${WALLET_SERVICE_BASE_URL}/payments/bnpl/summary`
    return clientApi<BnplSummary>(url)
}
