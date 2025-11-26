"use client"

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
 * - Without params: fetches all history
 * 라우트 핸들러를 통해 백엔드 API를 호출합니다.
 */
export async function getBnplHistory(params?: {
  year?: number
  month?: number
}): Promise<BnplHistoryResponse> {
  const queryParams = new URLSearchParams()

  // 파라미터가 있으면 쿼리에 추가, 없으면 전체 내역 조회
  if (params?.year) queryParams.append("year", params.year.toString())
  if (params?.month) queryParams.append("month", params.month.toString())

  const url = `/api/wallet/payments/bnpl/history${queryParams.toString() ? `?${queryParams.toString()}` : ""}`

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to fetch BNPL history: ${res.statusText}`
    )
  }

  return res.json()
}
