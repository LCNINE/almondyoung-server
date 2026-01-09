/*───────────────────────────
 * 현재 구독 응답 DTO
 *──────────────────────────*/
export interface CurrentSubscriptionResDto {
  success: boolean
  meta: {
    processedAt: string
  }
  data: {
    id: string
    userId: string
    planId: string
    status: "ACTIVE" | "ENDED" | "CANCELLED"
    startDate: string
    endDate: string | null
    createdAt: string
    updatedAt: string

    plan: {
      id: string
      tierId: string
      price: number
      currency: string
      durationDays: number
      trialDays: number
      isActive: boolean
      createdAt: string
      updatedAt: string
    }

    tier: {
      id: string
      code: string
      name: string | null
      priorityLevel: number
      createdAt: string
      updatedAt: string
    }
  }
}
