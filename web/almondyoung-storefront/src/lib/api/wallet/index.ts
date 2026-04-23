"use server"

import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import type {
  AuthorizePaymentDto,
  AuthorizePaymentErrorResponse,
  AuthorizePaymentSuccessResponse,
  BillingAgreementDto,
  BillingMethodDto,
  BnplHistoryDto,
  BnplSummaryDto,
  CreateIntentRequestDto,
  CreateIntentResponseDto,
  IntentDto,
  PointsBalanceDto,
  PointsEventRowDto,
  TaxInvoiceData,
  TaxInvoiceDto,
} from "@lib/types/dto/wallet"
import { api } from "../api"
import { HttpApiError } from "../api-error"

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
// 빌링 수단 관련 API (/v1/billing-methods)
// ==========================================

/**
 * 내 빌링 수단(정기결제 카드) 목록 조회
 */
export async function getBillingMethods(): Promise<BillingMethodDto[]> {
  try {
    return await api<BillingMethodDto[]>("wallet", "/v1/billing-methods", {
      method: "GET",
      cache: "no-store",
      withAuth: true,
    })
  } catch {
    return []
  }
}

/**
 * 빌링 어그리먼트(구독-카드 연결) 목록 조회
 */
export async function getBillingAgreements(): Promise<BillingAgreementDto[]> {
  try {
    return await api<BillingAgreementDto[]>("wallet", "/v1/billing-agreements", {
      method: "GET",
      cache: "no-store",
      withAuth: true,
    })
  } catch {
    return []
  }
}

/**
 * 빌링 어그리먼트의 결제 수단 변경
 * @param agreementId 변경할 billing_agreement ID
 * @param billingMethodId 새로 연결할 billing_method ID
 */
export async function updateBillingAgreementMethod(
  agreementId: string,
  billingMethodId: string,
): Promise<void> {
  await api<void>("wallet", `/v1/billing-agreements/${agreementId}/billing-method`, {
    method: "PUT",
    body: { billingMethodId },
    withAuth: true,
  })
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
 * 빌링 수단 삭제
 * @param billingMethodId 삭제할 billing_method ID
 */
export async function deleteBillingMethod(billingMethodId: string): Promise<void> {
  await api<void>("wallet", `/v1/billing-methods/${billingMethodId}`, {
    method: "DELETE",
    withAuth: true,
  })
}

// ==========================================
// BNPL 관련 API
// ==========================================

/**
 * 나중결제 내역 조회
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
  try {
    return await api<CreateIntentResponseDto>("wallet", `/v1/payment-intents`, {
      method: "POST",
      body: data,
      withAuth: true,
      cache: "no-store",
    })
  } catch (v1Error) {
    console.warn(
      "[wallet/createIntent] v1 auth path failed, trying legacy path"
    )
    try {
      const legacyPayload = {
        customerId: data.userId,
        originalAmount: data.amount,
        discountAmount: 0,
        type:
          typeof data.metadata?.type === "string"
            ? data.metadata.type
            : "ORDER",
        metadata: data.metadata,
        returnUrl: data.returnUrl,
      }

      const legacy = await api<{ id: string; customerId?: string }>(
        "wallet",
        `/payments/intents`,
        {
          method: "POST",
          body: legacyPayload,
          withAuth: true,
          cache: "no-store",
        }
      )

      return {
        id: legacy.id,
        userId: data.userId,
        status: "PENDING",
        payableAmount: data.amount,
        currency: data.currency,
        returnUrl: data.returnUrl ?? null,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      }
    } catch (legacyError) {
      console.warn(
        "[wallet/createIntent] legacy auth path failed, trying api-key path"
      )

      const { getBackendBaseUrl } = await import("@/lib/config/backend")
      const baseUrl = getBackendBaseUrl("wallet")
      const apiKey = process.env.WALLET_API_KEY

      if (!baseUrl) throw new Error("Missing wallet base URL")
      if (!apiKey) throw legacyError

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
        const message =
          err.message ??
          (legacyError instanceof Error
            ? legacyError.message
            : v1Error instanceof Error
              ? v1Error.message
              : `createIntent 실패: ${res.status}`)
        throw new Error(message)
      }

      return res.json() as Promise<CreateIntentResponseDto>
    }
  }
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
 * @param params.page 페이지 번호
 * @param params.limit 페이지당 개수
 * @param params.dateFrom 기간 시작 (ISO 8601)
 * @param params.dateTo 기간 종료 (ISO 8601)
 */
export async function getPointHistory(params?: {
  page?: number
  limit?: number
  dateFrom?: string
  dateTo?: string
}): Promise<PaginatedResponseDto<PointsEventRowDto>> {
  const queryParams = new URLSearchParams()
  if (params?.page) queryParams.append("page", params.page.toString())
  if (params?.limit) queryParams.append("limit", params.limit.toString())
  if (params?.dateFrom) queryParams.append("dateFrom", params.dateFrom)
  if (params?.dateTo) queryParams.append("dateTo", params.dateTo)

  return await api<PaginatedResponseDto<PointsEventRowDto>>(
    "wallet",
    `/v1/points/history${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "GET",
      cache: "no-store",
      withAuth: true,
    }
  )
}

/**
 * 포인트 잔액 조회
 */
export async function getPointBalance(): Promise<PointsBalanceDto> {
  return await api<PointsBalanceDto>("wallet", "/v1/points/balance", {
    method: "GET",
    cache: "no-store",
    withAuth: true,
  })
}

/*───────────────────────────
 * tax(세금 관련)
 *──────────────────────────*/

/**
 * (내 기본 세금 설정 조회)
 * @returns
 */
export async function getTaxInvoice(): Promise<TaxInvoiceDto> {
  return await api<TaxInvoiceDto>("wallet", "/tax-invoices/preferences", {
    method: "GET",
    withAuth: true,
  })
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
