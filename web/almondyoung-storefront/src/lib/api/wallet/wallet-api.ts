/**
 * Wallet API 클라이언트
 * 라우트 핸들러를 통해 백엔드 API를 호출합니다.
 * 클라이언트 측에서는 credentials: "include"로 쿠키가 자동 전달됩니다.
 */

import { HttpApiError } from "../api-error"
import type { CreateHmsCardProfileRequest } from "./wallet-types"

const API_BASE = "/api/wallet"

// ==========================================
// PIN 상태 관련 타입
// ==========================================

export interface PinStatus {
  hasPin: boolean
  status: "ACTIVE" | "LOCKED" | "NONE"
  failureCount?: number
}

export interface VerifyPasswordResponse {
  verificationToken: string
}

export interface PinVerifyResponse {
  verified: boolean
}

export interface PinErrorResponse {
  code: string
  message: string
  data?: {
    currentFailureCount?: number
    maxFailureCount?: number
  }
}

// ==========================================
// APick 관련 API
// ==========================================

/**
 * APick 계좌 조회
 * @param bankCode 은행 코드
 * @param accountNumber 계좌 번호
 */
export async function getApickAccount(bankCode: string, accountNumber: string) {
  const res = await fetch(`api/apick`, {
    method: "POST",
    body: JSON.stringify({ bankCode, accountNumber }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new HttpApiError(
      data.error || `Failed to fetch APick account: ${res.statusText}`,
      res.status,
      res.statusText,
      data
    )
  }

  return data
}
// ==========================================
// 결제 프로필 관련 API
// ==========================================

/**
 * 결제 프로필 목록 조회
 */
export async function getPaymentProfiles() {
  const res = await fetch(`${API_BASE}/payments/profiles`, {
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
      error.message || `Failed to fetch payment profiles: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * HMS 카드 프로필 생성
 * @param data HMS 카드 등록 정보
 */
export async function createHmsCardProfile(data: CreateHmsCardProfileRequest) {
  const res = await fetch(`${API_BASE}/payments/profiles/hms-card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to create HMS card profile: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * 기본 결제 수단 설정
 * @param profileId 프로필 ID
 */
export async function setDefaultPaymentProfile(profileId: string) {
  const res = await fetch(
    `${API_BASE}/payments/profiles/${profileId}/set-default`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    }
  )

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to set default profile: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * 결제 프로필 삭제
 * @param profileId 프로필 ID
 */
export async function deletePaymentProfile(profileId: string) {
  const res = await fetch(`${API_BASE}/payments/profiles/${profileId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to delete profile: ${res.statusText}`
    )
  }

  return res.json()
}

// ==========================================
// BNPL 관련 API
// ==========================================

/**
 * HMS BNPL 온보딩 (FormData)
 * @param formData FormData (서명 파일 포함)
 */
export async function onboardHmsBnpl(formData: FormData) {
  const res = await fetch(`${API_BASE}/payments/hms-bnpl/onboard`, {
    method: "POST",
    credentials: "include",
    // FormData는 Content-Type을 자동으로 설정하므로 명시하지 않음
    body: formData,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to onboard HMS BNPL: ${res.statusText}`
    )
  }

  return res.json()
}

// ==========================================
// 결제 Intent 관련 API
// ==========================================

/**
 * 결제 Intent 인증
 * @param intentId Intent ID
 * @param data 인증 데이터
 */
export async function authorizePayment(intentId: string, data: any) {
  const res = await fetch(
    `${API_BASE}/payments/intents/${intentId}/authorize`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(data),
    }
  )

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to authorize payment: ${res.statusText}`
    )
  }

  return res.json()
}

// ==========================================
// 결제 비밀번호 (PIN) 관련 API
// ==========================================

/**
 * PIN 상태 조회
 */
export async function getPinStatus(): Promise<PinStatus> {
  const res = await fetch(`${API_BASE}/payments/pin/status`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    cache: "no-store",
  })

  if (!res.ok) {
    const error: PinErrorResponse = await res.json().catch(() => ({
      code: "UNKNOWN_ERROR",
      message: "PIN 상태를 불러오는데 실패했습니다.",
    }))
    throw error
  }

  return res.json()
}

/**
 * PIN 등록
 */
export async function registerPin(pin: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/payments/pin/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ pin }),
  })

  if (!res.ok) {
    const error: PinErrorResponse = await res.json().catch(() => ({
      code: "UNKNOWN_ERROR",
      message: "PIN 등록에 실패했습니다.",
    }))
    throw error
  }

  return res.json()
}

/**
 * PIN 검증
 */
export async function verifyPin(pin: string): Promise<PinVerifyResponse> {
  const res = await fetch(`${API_BASE}/payments/pin/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ pin }),
  })

  if (!res.ok) {
    const error: PinErrorResponse = await res.json().catch(() => ({
      code: "UNKNOWN_ERROR",
      message: "PIN 검증에 실패했습니다.",
    }))
    throw error
  }

  return res.json()
}

/**
 * PIN 재설정 (본인인증 토큰 필요)
 */
export async function resetPin(
  newPin: string,
  verificationToken: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/payments/pin/reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-verification-token": verificationToken,
    },
    credentials: "include",
    body: JSON.stringify({ newPin }),
  })

  if (!res.ok) {
    const error: PinErrorResponse = await res.json().catch(() => ({
      code: "UNKNOWN_ERROR",
      message: "PIN 재설정에 실패했습니다.",
    }))
    throw error
  }

  return res.json()
}

/**
 * PIN 변경
 */
export async function changePin(
  currentPin: string,
  newPin: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/payments/pin/change`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ currentPin, newPin }),
  })

  if (!res.ok) {
    const error: PinErrorResponse = await res.json().catch(() => ({
      code: "UNKNOWN_ERROR",
      message: "PIN 변경에 실패했습니다.",
    }))
    throw error
  }

  return res.json()
}

// ==========================================
// 본인확인 (User Service)
// ==========================================

/**
 * 본인확인 (로그인 비밀번호 검증)
 * PIN 재설정을 위한 본인인증 토큰을 발급받습니다.
 * @param password 로그인 비밀번호
 */
export async function verifyPasswordForPinReset(
  password: string
): Promise<VerifyPasswordResponse> {
  const res = await fetch(`/api/auth/verify-password-for-pin-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ password }),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to verify password: ${res.statusText}`
    )
  }

  return res.json()
}

// ==========================================
// 포인트 관련 API
// ==========================================

/**
 * 포인트 내역 조회
 * @param limit 조회 개수 제한
 */
export async function getPointHistory(limit?: number) {
  const queryParams = new URLSearchParams()
  if (limit) queryParams.append("limit", limit.toString())

  const url = `${API_BASE}/payments/points/history${queryParams.toString() ? `?${queryParams.toString()}` : ""}`

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
      error.message || `Failed to fetch point history: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * 포인트 잔액 조회
 */
export async function getPointBalance() {
  const res = await fetch(`${API_BASE}/payments/points/balance`, {
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
      error.message || `Failed to fetch point balance: ${res.statusText}`
    )
  }

  return res.json()
}
