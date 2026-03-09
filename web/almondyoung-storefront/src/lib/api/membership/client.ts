"use client"

import type {
  SubscriptionDetailsDto,
  CycleBenefitDto,
  CycleBenefitHistoryDto,
} from "@lib/types/dto/membership"
import type {
  MonthlySavingsDto,
  RangeSavingsDto,
} from "@lib/types/dto/membership-savings"

const API_BASE = "/api/membership"

const unwrapData = <T>(payload: any): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T
  }
  return payload as T
}

const extractMembershipErrorMessage = (
  payload: any,
  fallback: string
): string => {
  const errorCode =
    payload?.error?.code ||
    payload?.code ||
    payload?.errorCode ||
    payload?.error?.error

  if (errorCode === "ACTIVE_SUBSCRIPTION_EXISTS") {
    return "이미 활성 구독이 존재합니다."
  }

  const candidates = [
    payload?.error?.message,
    payload?.message,
    Array.isArray(payload?.message) ? payload.message[0] : undefined,
    payload?.error?.details?.message,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate
    }
  }

  return fallback
}

export interface MembershipCheckoutIntentResponse {
  intentId: string
}

export async function getCurrentSubscription(): Promise<SubscriptionDetailsDto | null> {
  const res = await fetch(`${API_BASE}/subscriptions/current`, {
    method: "GET",
    credentials: "include",
  })

  if (res.status === 404) {
    return null
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch subscription: ${res.statusText}`)
  }

  const payload = await res.json()
  return unwrapData<SubscriptionDetailsDto>(payload)
}

export async function createSubscription(planId: string) {
  const res = await fetch(`${API_BASE}/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ planId }),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to create subscription: ${res.statusText}`
    )
  }

  return res.json()
}

export async function createMembershipCheckoutIntent(
  planId: string,
  returnUrl: string
): Promise<MembershipCheckoutIntentResponse> {
  const res = await fetch(`${API_BASE}/subscriptions/checkout-intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ planId, returnUrl }),
  })

  if (!res.ok) {
    const errorPayload = await res.json().catch(() => null)
    if (res.status === 500) {
      // 백엔드 ExceptionFilter 버그로 ACTIVE_SUBSCRIPTION_EXISTS가 500으로 내려오는 경우 대응
      const activeSubscription = await getCurrentSubscription().catch(() => null)
      if (activeSubscription) {
        throw new Error("이미 활성 구독이 존재합니다.")
      }
    }
    const fallback =
      res.status === 409
        ? "이미 활성 구독이 존재합니다."
        : `Failed to create membership checkout intent: ${res.statusText}`
    throw new Error(extractMembershipErrorMessage(errorPayload, fallback))
  }

  const payload = await res.json()
  return unwrapData<MembershipCheckoutIntentResponse>(payload)
}

export async function cancelSubscription(
  reasonCode: string,
  reasonText?: string
) {
  const res = await fetch(`${API_BASE}/subscriptions/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      reasonCode,
      reasonText,
    }),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to cancel subscription: ${res.statusText}`
    )
  }

  return res.json()
}

export async function getCurrentMonthSavings(): Promise<MonthlySavingsDto> {
  const res = await fetch(`${API_BASE}/membership/savings/current-month`, {
    method: "GET",
    credentials: "include",
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch savings: ${res.statusText}`)
  }

  return res.json()
}

export async function getRangeSavings(
  startDate: string,
  endDate: string
): Promise<RangeSavingsDto> {
  const res = await fetch(
    `${API_BASE}/membership/savings/range?startDate=${startDate}&endDate=${endDate}`,
    {
      method: "GET",
      credentials: "include",
    }
  )

  if (!res.ok) {
    throw new Error(`Failed to fetch savings: ${res.statusText}`)
  }

  return res.json()
}

export async function getCurrentCycleBenefit(
  userId: string
): Promise<CycleBenefitDto> {
  const res = await fetch(
    `${API_BASE}/membership/benefits/current?userId=${userId}`,
    {
      method: "GET",
      credentials: "include",
    }
  )

  if (!res.ok) {
    throw new Error(`Failed to fetch benefits: ${res.statusText}`)
  }

  return res.json()
}

export async function getCycleBenefitHistory(
  userId: string,
  limit: number = 12
): Promise<CycleBenefitHistoryDto> {
  const res = await fetch(
    `${API_BASE}/membership/benefits/history?userId=${userId}&limit=${limit}`,
    {
      method: "GET",
      credentials: "include",
    }
  )

  if (!res.ok) {
    throw new Error(`Failed to fetch benefits: ${res.statusText}`)
  }

  return res.json()
}
