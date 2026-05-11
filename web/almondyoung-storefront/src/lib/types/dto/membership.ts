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

export interface CurrentSubscriptionResDto {
  success: boolean
  meta: {
    processedAt: string
  }
  data: SubscriptionDetailsDto
}

export interface SubscriptionAdjustmentDto {
  id: number
  eventType: "ENTITLEMENT_EXTENDED" | "ENTITLEMENT_REDUCED"
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
