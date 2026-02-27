"use server"

import type {
  AuthorizePaymentDto,
  AuthorizePaymentErrorResponse,
  AuthorizePaymentSuccessResponse,
  BnplHistoryDto,
  BnplProfileDto,
  BnplSummaryDto,
  CreateHmsCardProfileRequest,
  CreateIntentRequestDto,
  CreateIntentResponseDto,
  IntentDto,
  OnboardHmsBnplResponse,
  PointBalanceDto,
  TaxInvoiceData,
  TaxInvoiceDto,
} from "@lib/types/dto/wallet"
import { api } from "../api"
import { ApiNetworkError, HttpApiError } from "../api-error"

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

/**
 * APick 계좌 조회
 * @param bankCode 은행 코드
 * @param accountNumber 계좌 번호
 */
export async function getApickAccount(bankCode: string, accountNumber: string) {
  const res = await fetch(`${process.env.APP_URL}/api/apick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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
export async function getBnplProfiles(): Promise<BnplProfileDto[] | null> {
  try {
    const data = await api<BnplProfileDto[]>("wallet", "/payments/profiles", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      withAuth: true,
    })

    return data
  } catch (error) {
    console.error("BNPL 프로필 조회 실패:", error)
    // 에러 발생 시 null 반환하여 페이지는 정상 렌더링되도록 함
    return null
  }
}

export async function getBnplSummary(): Promise<BnplSummaryDto> {
  const result = await api<BnplSummaryDto>("wallet", "/payments/bnpl/summary", {
    method: "GET",
    cache: "no-store",
    withAuth: true,
  })

  return result
}

/**
 * HMS 카드 프로필 생성
 * @param data HMS 카드 등록 정보
 */
export async function createHmsCardProfile(data: CreateHmsCardProfileRequest) {
  const res = await api("wallet", "/payments/profiles/hms-card", {
    method: "POST",
    body: data,
    withAuth: true,
  })

  return res
}

/**
 * 기본 결제 수단 설정
 * @param profileId 프로필 ID
 */
export async function setDefaultPaymentProfile(profileId: string) {
  const data = await api<{ success: boolean }>(
    "wallet",
    `/payments/profiles/${profileId}/set-default`,
    {
      method: "PUT",
      withAuth: true,
    }
  )

  return data
}

/**
 * 결제 프로필 삭제
 * @param profileId 프로필 ID
 */
export async function deletePaymentProfile(profileId: string) {
  const res = await api<{ success: boolean }>(
    "wallet",
    `/payments/profiles/${profileId}`,
    {
      method: "DELETE",
      withAuth: true,
    }
  )

  return res
}

// ==========================================
// BNPL 관련 API
// ==========================================

/**
 * 나중결제 내역 조회
 * @param limit 조회 개수 제한
 */
export async function getBnplHistory(
  year: number,
  month: number
): Promise<BnplHistoryDto> {
  const result = await api<BnplHistoryDto>(
    "wallet",
    `/payments/bnpl/history?year=${year}&month=${month}`,
    {
      method: "GET",
      withAuth: true,
    }
  )

  return result
}

/**
 * HMS BNPL 온보딩 (FormData)
 * @param formData FormData (서명 파일 포함)
 */
export async function onboardHmsBnpl(_: any, formData: FormData) {
  try {
    const data = await api<OnboardHmsBnplResponse>(
      "wallet",
      "/payments/hms-bnpl/onboard",
      {
        method: "POST",
        body: formData,
        credentials: "include",
      }
    )

    return { ...data, success: true }
  } catch (error) {
    if (error instanceof HttpApiError) {
      if (error.message.includes("Bad Request Exception")) {
        return {
          message:
            "정기결제 신청에 실패했습니다. 입력하신 정보를 확인해주세요.",
          success: false,
        }
      }

      return {
        message: error.message || "정기결제 신청에 실패했습니다.",
        success: false,
      }
    }

    if (error instanceof ApiNetworkError) {
      return {
        message: error.message || "네트워크 에러가 발생했습니다.",
        success: false,
      }
    }
  }
}
// ==========================================
// 결제 Intent 관련 API
// ==========================================

/**
 * 결제 Intent 인증
 * @param intentId Intent ID
 * @param data 인증 데이터
 */
export async function authorizePayment(
  intentId: string,
  data: AuthorizePaymentDto
): Promise<AuthorizePaymentSuccessResponse | AuthorizePaymentErrorResponse> {
  const result = await api<
    AuthorizePaymentSuccessResponse | AuthorizePaymentErrorResponse
  >("wallet", `/payments/intents/${intentId}/authorize`, {
    method: "POST",
    body: data,
    withAuth: true,
    cache: "no-store",
  })
  return result
}

export async function createIntent({ data }: { data: CreateIntentRequestDto }) {
  const { getBackendBaseUrl } = await import("@/lib/config/backend")
  const baseUrl = getBackendBaseUrl("wallet")
  const apiKey = process.env.WALLET_API_KEY

  if (!baseUrl) throw new Error("Missing wallet base URL")
  if (!apiKey) throw new Error("Missing WALLET_API_KEY")

  const res = await fetch(`${baseUrl}/v1/payment-intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(data),
    cache: "no-store",
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message ?? `createIntent 실패: ${res.status}`)
  }

  return res.json() as Promise<CreateIntentResponseDto>
}

export async function getIntent(intentId: string): Promise<IntentDto> {
  return await api<IntentDto>("wallet", `/v1/payment-intents/${intentId}`, {
    method: "GET",
    withAuth: true,
  })
}

// ==========================================
// 결제 비밀번호 (PIN) 관련 API
// ==========================================

/**
 * PIN 상태 조회
 */
export async function getPinStatus(): Promise<PinStatus> {
  const result = await api<PinStatus>("wallet", "/payments/pin/status", {
    method: "GET",
    withAuth: true,
  })

  return result
}

/**
 * PIN 등록
 */
export async function registerPin(pin: string): Promise<{ success: boolean }> {
  const result = await api<{ success: boolean }>(
    "wallet",
    "/payments/pin/register",
    {
      method: "POST",
      body: { pin },
      withAuth: true,
    }
  )

  return result
}

/**
 * PIN 검증
 */
export async function verifyPin(pin: string): Promise<PinVerifyResponse> {
  const result = await api<PinVerifyResponse>(
    "wallet",
    "/payments/pin/verify",
    {
      method: "POST",
      body: { pin },
      withAuth: true,
    }
  )

  return result
}

/**
 * PIN 재설정 (본인인증 토큰 필요)
 */
export async function resetPin(newPin: string): Promise<{ success: boolean }> {
  const result = await api<{ success: boolean }>(
    "wallet",
    "/payments/pin/reset",
    {
      method: "POST",
      body: { newPin },
      withAuth: true,
    }
  )

  return result
}

/**
 * PIN 변경
 */
export async function changePin(
  currentPin: string,
  newPin: string
): Promise<{ success: boolean }> {
  const result = await api<{ success: boolean }>(
    "wallet",
    "/payments/pin/change",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: { currentPin, newPin },
      withAuth: true,
    }
  )

  return result
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
  const result = await api<VerifyPasswordResponse>(
    "users",
    "/verify-password-for-pin-reset",
    {
      method: "POST",
      body: { password },
      withAuth: true,
    }
  )

  return result
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

  const result = await api(
    "wallet",
    `/payments/points/history${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "GET",
      cache: "no-store",
      withAuth: true,
    }
  )

  return result
}

/**
 * 포인트 잔액 조회
 */
// TODO: 임시 mock 객체 사용
export async function getPointBalance(): Promise<PointBalanceDto> {
  return {
    balance: 0,
    withdrawable: 0,
  }
  // return await api<PointBalanceDto>("wallet", "/payments/points/balance", {
  //   method: "GET",
  //   cache: "no-store",
  //   withAuth: true,
  // })
}

/*───────────────────────────
 * tax(세금 관련)
 *──────────────────────────*/

/**
 * (내 기본 세금 설정 조회)
 * @returns
 */
export async function getTaxInvoice(): Promise<TaxInvoiceDto> {
  // TODO: 임시 mock 객체 사용
  return {
    userId: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    defaultEnabled: 1,
    defaultBusinessInfo: {
      name: "테스트 사업자",
      businessNumber: "1234567890",
      address: "서울특별시 강남구 역삼동 123-456",
      ownerName: "테스트 대표자",
    }
  }
  // return await api<TaxInvoiceDto>("wallet", "/tax-invoices/preferences", {
  //   method: "GET",
  //   withAuth: true,
  // })
}

/**
 * (내 기본 세금 설정 업데이트)
 * @param data 업데이트할 세금 설정 데이터
 */
export async function updateTaxInvoice({
  defaultBusinessInfo,
  defaultEnabled,
}: {
  defaultBusinessInfo: TaxInvoiceData
  defaultEnabled: boolean
}): Promise<TaxInvoiceDto> {
  const data = {
    defaultBusinessInfo,
    defaultEnabled,
  }
  console.log("data:", data)

  return await api<TaxInvoiceDto>("wallet", "/tax-invoices/preferences", {
    method: "PATCH",
    body: data,
    withAuth: true,
  })
}
