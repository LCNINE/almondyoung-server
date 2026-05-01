/**
 * 멤버십 관련 타입 정의
 */

export type PlanWithTier = {
  plan: {
    id: string
    tierId: string
    price: number
    durationDays: number
    currency: string
    trialDays: number
    isActive: boolean
    createdAt: string
    updatedAt: string
  }
  tier: {
    id: string
    code: string
    name: string
    priorityLevel: number
    createdAt: string
    updatedAt: string
  }
}

export type HmsCardProfileRequest = {
  // userId와 memberId는 서버에서 자동 처리
  memberName: string
  phone: string
  payerNumber: string
  paymentNumber: string
  payerName: string
  validYear: string
  validMonth: string
  validUntil: string
  password: string
  paymentCompany: string
}

export type CreateSubscriptionRequest = {
  planId: string
}

export type PlansListResponse = {
  success: boolean
  data: PlanWithTier[]
  count: number
  meta: {
    retrievedAt: string
    source: string
  }
}
