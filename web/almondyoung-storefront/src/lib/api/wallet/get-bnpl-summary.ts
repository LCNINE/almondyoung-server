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
 * 라우트 핸들러를 통해 백엔드 API를 호출합니다.
 */
export async function getBnplSummary(): Promise<BnplSummary> {
  const res = await fetch("/api/wallet/payments/bnpl/summary", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(error.message || `Failed to fetch BNPL summary: ${res.statusText}`)
  }

  return res.json()
}
