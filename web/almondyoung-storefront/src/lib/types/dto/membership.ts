/*───────────────────────────
 * 현재 구독 응답 DTO
 *──────────────────────────*/
export type SubscriptionStatus = "ACTIVE" | "PAUSED" | "RECURRING_CANCELLED" | "ENDED" | "CANCELLED" | "EXPIRED"

export interface MembershipTierDto {
  id: string
  code: string
  name: string | null
  priorityLevel: number
  createdAt: string
  updatedAt: string
}

export interface MembershipPlanDto {
  id: string
  tierId: string
  price: number
  currency: string
  durationDays: number
  trialDays: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  tier?: MembershipTierDto
}

export interface SubscriptionDetailsDto {
  id: string
  userId: string
  planId: string
  status: SubscriptionStatus
  autoRenewal?: boolean
  pausedAt?: string | null
  recurringCancelledAt?: string | null
  paymentActionNeeded?: boolean
  startDate: string
  endDate: string | null
  createdAt: string
  updatedAt: string
  billingDate?: string | null
  nextBillingDate?: string | null
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  plan: MembershipPlanDto
  tier: MembershipTierDto
}

/*───────────────────────────
 * 해지 미리보기 (서버 정책 SoT)
 *──────────────────────────*/
export type CancellationMode = "AT_PERIOD_END" | "IMMEDIATE_REFUND"

export interface CancellationOptionDto {
  mode: CancellationMode
  available: boolean
  unavailableReason?: string
  refundAmount: number
  refundKind:
    | "NONE"
    | "WITHDRAWAL_FULL"
    | "ANNUAL_PRORATION"
    /** 효성 CMS 선지급 — 아직 출금 전이라 청구 없이 종료된다(환불액 0) */
    | "PRE_COLLECTION_WITHDRAWAL"
  refundExecution: "NONE" | "AUTO" | "MANUAL"
  /** 환불 송금 계좌 입력이 필요한지 */
  requiresReceiveAccount: boolean
  /** 이 방식을 택했을 때 이용이 끝나는 날 (YYYY-MM-DD) */
  effectiveEndsAt: string
  breakdown?: {
    paidAmount: number
    monthlyListPrice: number
    monthsElapsed: number
    usageDeduction: number
    benefitDeduction: number
  }
}

export interface CancellationPreviewDto {
  contractId: string
  planName: { durationDays: number; price: number }
  isRecurring: boolean
  alreadyScheduledForCancellation: boolean
  recurringCancelledAt: string | null
  currentPeriodEndsAt: string
  nextBillingDate: string | null
  recommendedMode: CancellationMode
  withdrawalDaysRemaining: number
  withdrawalWindowDays: number
  refundProcessingBusinessDays: number
  /** 해지 예약을 철회해 자동결제를 재개할 수 있는지 (1회 결제는 false) */
  canUndoCancellation: boolean
  options: CancellationOptionDto[]
}

export interface CurrentSubscriptionResDto {
  success: boolean
  meta: {
    processedAt: string
  }
  data: SubscriptionDetailsDto
}

export interface SubscriptionAdjustmentDto {
  id: number
  eventType: "ENTITLEMENT_EXTENDED" | "ENTITLEMENT_REDUCED" | "GRANTED_BY_ADMIN"
  days: number
  previousEndsAt: string | null
  newEndsAt: string | null
  reason: string | null
  createdAt: string
}

export interface SubscriptionHistoryItemDto {
  id: string
  userId: string
  planId: string
  status: SubscriptionStatus
  billingDate?: string
  nextBillingDate?: string | null
  cancelledAt?: string | null
  autoRenewal?: boolean
  createdAt: string
  updatedAt: string
  endDate?: string | null
  plan?: { price: number; currency: string; durationDays: number } | null
  tier?: { code: string } | null
  adjustments?: SubscriptionAdjustmentDto[]
  // legacy compat
  startDate?: string
}

export interface SubscriptionHistoryResDto {
  success: boolean
  meta: {
    processedAt: string
  }
  count: number
  data: SubscriptionHistoryItemDto[]
}

export interface CancellationReasonDto {
  code: string
  displayText: string
  category: string
  sortOrder: number
}

export interface CancellationReasonsResDto {
  reasons: CancellationReasonDto[]
}

export interface CycleBenefitDto {
  userId: string
  cycleStartDate: string
  cycleEndDate: string
  totalDiscountAmount: number
  orderCount: number
  daysRemaining: number
  daysElapsed: number
  subscriptionType: "MONTHLY" | "YEAR"
  nextCycleStartDate: string
}

export interface CycleBenefitHistoryDto {
  userId: string
  cycles: Array<{
    cycleStartDate: string
    cycleEndDate: string
    totalDiscountAmount: number
    orderCount: number
    isCompleted: boolean
  }>
  totalCycles: number
  totalDiscountAllTime: number
}

/** 환불 진행 상황 — 해지 직후 안내를 놓쳐도 다시 확인할 수 있어야 한다. */
export interface RefundStatusDto {
  contractId: string
  amount: number
  status: "COMPLETED" | "PENDING" | "FAILED"
  requestedAt: string | null
  completedAt: string | null
  refundProcessingBusinessDays: number
  /** 계좌번호는 뒤 4자리만 온다 */
  maskedAccount: { bank: string; accountNumber: string; holderName: string } | null
}
