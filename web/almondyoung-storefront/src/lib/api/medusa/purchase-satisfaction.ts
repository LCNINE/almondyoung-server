"use server"

import { api } from "@lib/api/api"
import { getAuthHeaders } from "@lib/data/cookies"
import { ApiAuthError, HttpApiError } from "@lib/api/api-error"

export type PurchaseSatisfaction = {
  rating: number
  reasons: string[]
  memo: string | null
}

export type PurchaseSatisfactionInput = {
  rating: number
  reasons?: string[]
  memo?: string
}

type SatisfactionResponse = { satisfaction: PurchaseSatisfaction }

const path = (orderId: string) =>
  `/store/orders/${encodeURIComponent(orderId)}/purchase-satisfaction`

async function requireAuthHeaders() {
  const headers = await getAuthHeaders()
  if (!headers) throw new ApiAuthError("UNAUTHORIZED", 401, "UNAUTHORIZED")
  return headers
}

export async function getPurchaseSatisfaction(
  orderId: string
): Promise<PurchaseSatisfaction | null> {
  const headers = await requireAuthHeaders()
  try {
    const res = await api<SatisfactionResponse>("medusa", path(orderId), {
      method: "GET",
      withAuth: false,
      headers,
    })
    return res.satisfaction
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 404) return null
    throw error
  }
}

export async function savePurchaseSatisfaction(
  orderId: string,
  input: PurchaseSatisfactionInput
): Promise<PurchaseSatisfaction> {
  const headers = await requireAuthHeaders()
  const res = await api<SatisfactionResponse>("medusa", path(orderId), {
    method: "PUT",
    body: input,
    withAuth: false,
    headers,
    timeout: 15000,
  })
  return res.satisfaction
}
