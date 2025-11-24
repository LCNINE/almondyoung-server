import { clientApi } from "@lib/api/client-api"

/**
 * 결제 프로필 타입
 */
export type PaymentProfile = {
  id: string
  kind: "CARD" | "BANK_ACCOUNT" | "WALLET"
  provider: "HMS_CARD" | "HMS_BNPL" | "TOSS"
  status: string
  name: string | null
  details?: {
    paymentCompany: string | null // 카드사 코드 (예: "088")
    paymentCompanyName: string // 카드사 한글명 (예: "신한카드")
    paymentNumber: string | null // 마스킹된 카드번호 (예: "****-****-****-1234")
    cardLast4: string | null // 카드 뒤 4자리
    cardBrand: string | null // 카드 브랜드
    payerName: string | null // 납부자명
    phoneMask: string | null // 마스킹된 전화번호
    cmsStatus: string | null // CMS 상태
  } | null
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
