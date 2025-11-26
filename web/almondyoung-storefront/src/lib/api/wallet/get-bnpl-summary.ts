"use client"

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
  const url = `${process.env.BACKEND_URL}/payments/bnpl/summary`
  return await fetch(url).then((res) => res.json())
}
