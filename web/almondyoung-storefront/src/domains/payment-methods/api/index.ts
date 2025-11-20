import { clientApi } from "@lib/api/client-api"

/**
 * 결제 프로필 타입
 */
export type PaymentProfile = {
  id: string
  kind: "CARD" | "BANK_ACCOUNT" | "WALLET"
  provider: "HMS_CARD" | "HMS_BNPL" | "TOSS"
  status: string
  name: string
  details?: {
    paymentCompany?: string
    paymentNumber?: string
    [key: string]: any
  }
  createdAt: string
}

/**
 * HMS 카드 등록 요청 타입
 */
export type CreateHmsCardProfileRequest = {
  memberName: string
  phone: string
  payerNumber: string
  paymentNumber: string
  payerName: string
  validYear: string
  validMonth: string
  validUntil: string
  password: string
  paymentCompany?: string
}

/**
 * 사용자의 모든 결제 프로필 조회
 */
export async function refundGetPaymentProfiles(): Promise<PaymentProfile[]> {
  const response = await clientApi<PaymentProfile[]>(
    "/api/wallet/payments/profiles",
    {
      method: "GET",
    }
  )
  return response
}

/**
 * HMS 카드 프로필 생성
 */
export async function refundCreateHmsCardProfile(
  data: CreateHmsCardProfileRequest
): Promise<{ profileId: string }> {
  const response = await clientApi<{ profileId: string }>(
    "/api/wallet/payments/profiles/hms-card",
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  )
  return response
}

