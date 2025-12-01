/**
 * Payment PIN API 클라이언트
 * Wallet 서비스의 결제 비밀번호(PIN) 관리 API를 호출합니다.
 */

const API_BASE = "/api/wallet"

// ==========================================
// PIN 상태 타입
// ==========================================

export interface PinStatus {
  hasPin: boolean
  status: "ACTIVE" | "LOCKED"
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
// PIN 상태 조회
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
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to fetch PIN status: ${res.statusText}`
    )
  }

  return res.json()
}

// ==========================================
// PIN 등록
// ==========================================

/**
 * PIN 등록
 * @param pin 6자리 숫자 PIN
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

// ==========================================
// PIN 검증
// ==========================================

/**
 * PIN 검증
 * @param pin 6자리 숫자 PIN
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

// ==========================================
// PIN 재설정
// ==========================================

/**
 * PIN 재설정
 * @param newPin 새로운 6자리 숫자 PIN
 * @param verificationToken 본인인증 완료 토큰
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
