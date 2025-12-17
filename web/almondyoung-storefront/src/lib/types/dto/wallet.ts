/**
 * 결제 프로필 타입
 */
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
 * HMS BNPL 온보딩 응답 타입
 */
export type OnboardHmsBnplResponse = {
  success: boolean
  profileId: string
  memberId: string
}

/**
 * 포인트 잔액 조회
 */
export type PointBalanceDto = {
  balance: number // 포인트 잔액
  withdrawable: number // 출금 가능 포인트
}

/**
 * 나중결제 요약 조회
 */
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

/**
 * 나중결제 내역 조회
 */
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
