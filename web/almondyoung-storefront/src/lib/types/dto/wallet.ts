import type { PaginatedResponseDto } from "../common/pagination"

/*───────────────────────────
 * Intent
 *──────────────────────────*/
export interface DiscountBreakdown {
  amount: number // 차감액
  type: "COUPON" | "POINT" | "PROMOTION"
  id?: string // 쿠폰 ID, 프로모션 코드 등
  description?: string // "신규가입 쿠폰"
}

export type CreateIntentRequestDto = {
  userId: string
  amount: number
  currency: string
  returnUrl?: string
  metadata?: Record<string, unknown>
}

export type CreateIntentResponseDto = {
  id: string
  userId: string
  status: string
  payableAmount: number
  currency: string
  returnUrl: string | null
  expiresAt: string
  createdAt: string
}

export type IntentDto = {
  id: string
  userId: string
  status: string
  payableAmount: number
  currency: string
  returnUrl: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown> | null
}

/*───────────────────────────
 * 결제
 *──────────────────────────*/

export type AuthorizePaymentDto = {
  authParams?: Record<string, string> | null
  profileId?: string | null
  provider: "TOSS" | "HMS_CARD" | "HMS_BNPL"
  usePoints?: number | null
}

/** authorize 결제 성공 응답 */
export type AuthorizePaymentSuccessResponse = {
  success: true
  intentId: string
  attemptId?: string
  status: string
  provider: string
  amount: number
  paymentKey: string
  message: string
  pointEventId?: number
  breakdown?: {
    totalAmount: number
    pointsUsed: number
    finalAmount: number
  }
}

/** authorize 결제 실패 응답 */
export type AuthorizePaymentErrorResponse = {
  success: false
  message: string
  statusCode: number
  timestamp?: string
}

/*───────────────────────────
 * BNPL Profile
 *──────────────────────────*/
export type BnplProfileDto = {
  id: string
  kind: "CARD" | "BANK_ACCOUNT" | "WALLET"
  provider: "HMS_CARD" | "HMS_BNPL" | "TOSS"
  status: string
  name: string | null
  isDefault?: boolean // 기본 결제 수단 여부
  createdAt: string
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
}

/*───────────────────────────
 * HMS 카드 등록 요청
 *──────────────────────────*/
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

/*───────────────────────────
 * 빌링 수단 (billing_methods)
 *──────────────────────────*/
export type BillingMethodDto = {
  id: string
  userId: string
  providerType: 'TOSS_BILLING' | 'NICEPAY_BILLING' | 'CMS_BATCH'
  displayName: string | null
  method: Record<string, unknown> | null
  status: 'ACTIVE' | 'REVOKED' | 'DELETED' | 'EXPIRED'
  expiresAt: string | null
  createdAt: string
}

/*───────────────────────────
 * 빌링 어그리먼트 (billing_agreements)
 *──────────────────────────*/
export type BillingAgreementDto = {
  id: string
  userId: string
  billingMethodId: string
  subscriberRef: string
  subscriberType: string
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
  createdAt: string
}

/*───────────────────────────
 * HMS BNPL 온보딩 응답 (레거시)
 *──────────────────────────*/
export type OnboardHmsBnplResponse = {
  success: boolean
  profileId: string
  memberId: string
}

/*───────────────────────────
 * 포인트 (wallet points)
 *──────────────────────────*/

export type PointEventType = "EARN" | "REDEEM" | "EARN_CANCEL" | "REDEEM_CANCEL"

/*───────────────────────────
 * 포인트 잔액 조회
 *──────────────────────────*/
export type PointsBalanceDto = {
  /** 확정된 총 적립 포인트 */
  confirmed: number
  /** 결제 진행 중 hold 잡혀있는 포인트 */
  reserved: number
  /** 지금 사용 가능한 포인트 (서버에서 계산되어 내려옴) */
  available: number
}

/** 포인트 이벤트(내역) */
export type PointsEventRowDto = {
  id: string
  userId: string
  eventType: PointEventType
  amount: number
  originalEventId: string | null
  reasonCode: string | null
  createdAt: string
}

/*───────────────────────────
 * 나중결제 요약 조회
 *──────────────────────────*/
export type BnplSummaryDto = {
  hasAccount: boolean
  creditLimit: number | null
  availableLimit: number | null
  usedAmount: number | null
  nextBillingDate: string | null
  dDay: number | null
  targetYear: number | null
  targetMonth: number | null
}

/*───────────────────────────
 * 나중결제 내역 조회
 *──────────────────────────*/
export type BnplHistoryDto = {
  events: {
    id: string
    eventType: "PURCHASE" | "PAYMENT" | string // todo: 실제로 어떤 타입을 받는지 확인해볼 필요가있음
    eventCategory: "CREDIT" | "DEBIT" | string
    amount: number
    status: "COMPLETED" | "PENDING" | "FAILED" | string
    createdAt: string
    title: string
  }[]
  month: number
  totalAmount: number
  year: number
}

/*───────────────────────────
 * 세금 계산서
 *──────────────────────────*/

export type TaxInvoiceDto = {
  userId: string
  createdAt: Date
  updatedAt: Date
  defaultEnabled: number
  defaultBusinessInfo: TaxInvoiceData
}

/** 세금계산서 사업자 정보 */
export interface TaxInvoiceData {
  name: string // 사업자명
  businessNumber: string
  address: string // 사업장 주소
  ownerName: string // 대표이사명
}

/*───────────────────────────
 * 현금영수증
 *──────────────────────────*/

export type CashReceiptDto = {
  userId: string
  createdAt: Date
  updatedAt: Date
  defaultEnabled: number
  defaultInfo: CashReceiptData
}

/** 현금영수증 정보 */
export interface CashReceiptData {
  type: "business" | "personal" // 사업자/개인
  name: string // 상호명 또는 성명
  number: string // 사업자등록번호 또는 휴대폰번호
}
