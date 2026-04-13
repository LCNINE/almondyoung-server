"use server"

import type {
  CancellationReasonDto,
  CancellationReasonsResDto,
  CycleBenefitDto,
  CycleBenefitHistoryDto,
  MembershipPlanDto,
  MembershipTierDto,
  SubscriptionDetailsDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import type { PlanWithTier } from "@lib/types/membership"
import { api } from "../api"
import { ApiAuthError, HttpApiError } from "../api-error"
import type {
  MonthlySavingsDto,
  RangeSavingsDto,
} from "@lib/types/dto/membership-savings"

/**
 * 현재 구독 조회
 */
export async function getCurrentSubscription(): Promise<SubscriptionDetailsDto | null> {
  try {
    return await api<SubscriptionDetailsDto>(
      "membership",
      `/subscriptions/current`,
      {
        withAuth: true,
        cache: "no-store",
      }
    )
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 404) {
      return null
    }
    throw error
  }
}

/**
 * 구독 이력 조회
 */
export async function getSubscriptionHistory(): Promise<
  SubscriptionHistoryItemDto[]
> {
  return await api<SubscriptionHistoryItemDto[]>(
    "membership",
    `/subscriptions/history`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

/**
 * 구독 취소 사유 목록 조회
 */
export async function getCancellationReasons(): Promise<
  CancellationReasonDto[]
> {
  const result = await api<CancellationReasonsResDto>(
    "membership",
    `/subscriptions/cancellation-reasons`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )

  return result.reasons ?? []
}

/**
 * 구독 취소
 * @param reasonCode 취소 사유 코드
 * @param reasonText 취소 사유 설명
 * @returns
 */
export async function cancelSubscription(
  reasonCode: string,
  reasonText?: string
) {
  return await api("membership", "/subscriptions/cancel", {
    method: "POST",
    body: { reasonCode, reasonText },
    withAuth: true,
    cache: "no-store",
  })
}

/**
 * 현재 주기 혜택 조회
 */
export async function getCurrentCycleBenefit(
  userId: string
): Promise<CycleBenefitDto> {
  return await api<CycleBenefitDto>(
    "membership",
    `/membership/benefits/current`,
    {
      method: "GET",
      params: { userId },
      withAuth: true,
      cache: "no-store",
    }
  )
}

/**
 * 혜택 이력 조회
 */
export async function getCycleBenefitHistory(
  userId: string,
  limit: number = 12
): Promise<CycleBenefitHistoryDto> {
  return await api<CycleBenefitHistoryDto>(
    "membership",
    `/membership/benefits/history`,
    {
      method: "GET",
      params: { userId, limit: String(limit) },
      withAuth: true,
      cache: "no-store",
    }
  )
}

/**
 * 멤버십 플랜 목록 조회
 */
export async function getPlans() {
  const result = await api<PlanWithTier[]>("membership", `/plans`, {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })
  return result
}

/**
 * 멤버십 구독 생성
 */
export async function createSubscription(planId: string) {
  return await api("membership", "/subscriptions", {
    method: "POST",
    body: { planId },
    withAuth: true,
    cache: "no-store",
  })
}

/**
 * 티어별 혜택(플랜 포함) 조회
 */
export async function getTierBenefits(tierId: string): Promise<{
  tier: MembershipTierDto
  plans: MembershipPlanDto[]
}> {
  return await api<{ tier: MembershipTierDto; plans: MembershipPlanDto[] }>(
    "membership",
    `/tiers/${tierId}/benefits`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

// 이번달 절약액 조회
export async function getCurrentMonthSavings(): Promise<MonthlySavingsDto> {
  return await api<MonthlySavingsDto>(
    "membership",
    "/membership/savings/current-month",
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

// 특정 월 절약액 조회
export async function getMonthSavings(
  yearMonth: string
): Promise<MonthlySavingsDto> {
  return await api<MonthlySavingsDto>(
    "membership",
    `/membership/savings/month/${yearMonth}`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

// 기간별 절약액 조회
export async function getRangeSavings(
  startDate: string,
  endDate: string
): Promise<RangeSavingsDto> {
  return await api<RangeSavingsDto>(
    "membership",
    `/membership/savings/range?startDate=${startDate}&endDate=${endDate}`,
    {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    }
  )
}

/**
 * 멤버십 결제 인텐트 생성
 */
export async function createMembershipCheckoutIntent(
  planId: string,
  returnUrl: string
): Promise<{ intentId: string }> {
  try {
    return await api<{ intentId: string }>(
      "membership",
      "/subscriptions/checkout-intent",
      {
        method: "POST",
        body: { planId, returnUrl },
        withAuth: true,
        cache: "no-store",
      }
    )
  } catch (error) {
    // UNAUTHORIZED는 re-throw → error.tsx에서 토큰 복구 처리
    if (error instanceof ApiAuthError) {
      throw error
    }
    // 500 에러: 백엔드 버그로 ACTIVE_SUBSCRIPTION_EXISTS가 500으로 내려오는 경우 대응
    if (error instanceof HttpApiError && error.status === 500) {
      const activeSubscription = await getCurrentSubscription().catch(
        () => null
      )
      if (activeSubscription) {
        throw new Error("이미 활성 구독이 존재합니다.")
      }
    }
    // 409 에러: 이미 활성 구독 존재
    if (error instanceof HttpApiError && error.status === 409) {
      throw new Error("이미 활성 구독이 존재합니다.")
    }
    // 기타 에러: plain Error로 변환하여 Next.js Server Action 직렬화 문제 방지
    throw new Error(
      error instanceof Error ? error.message : "멤버십 결제 준비에 실패했습니다."
    )
  }
}
