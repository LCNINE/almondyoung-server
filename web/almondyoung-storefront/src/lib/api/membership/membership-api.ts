/**
 * 멤버십 API 클라이언트
 * 라우트 핸들러를 통해 백엔드 API를 호출합니다.
 * 클라이언트 측에서는 credentials: "include"로 쿠키가 자동 전달됩니다.
 */

const API_BASE = "/api/membership"

/**
 * 현재 구독 조회
 */
export async function getCurrentSubscription() {
  const res = await fetch(`${API_BASE}/subscriptions/current`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // 쿠키 자동 전달
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(error.message || `Failed to fetch current subscription: ${res.statusText}`)
  }

  return res.json()
}

/**
 * 멤버십 플랜 목록 조회
 */
export async function getPlans() {
  const res = await fetch(`${API_BASE}/plans`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(error.message || `Failed to fetch plans: ${res.statusText}`)
  }

  return res.json()
}

/**
 * 멤버십 구독 생성
 * @param planId 선택한 플랜 ID
 */
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
    throw new Error(error.message || `Failed to create subscription: ${res.statusText}`)
  }

  return res.json()
}

/**
 * 멤버십 구독 취소
 * @param reasonCode 취소 이유 코드
 * @param reasonText 취소 이유 상세 설명 (선택)
 */
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
    throw new Error(error.message || `Failed to cancel subscription: ${res.statusText}`)
  }

  return res.json()
}

