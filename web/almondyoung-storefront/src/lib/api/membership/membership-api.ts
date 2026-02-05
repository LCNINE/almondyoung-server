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
import { HttpApiError } from "../api-error"

/**
 * 현재 구독 조회
 */
export async function getCurrentSubscription(): Promise<SubscriptionDetailsDto | null> {
  try {
    return await api<SubscriptionDetailsDto>("membership", `/subscriptions/current`, {
      withAuth: true,
      cache: "no-store",
    })
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
 * 현재 주기 혜택 조회
 */
export async function getCurrentCycleBenefit(
  userId: string
): Promise<CycleBenefitDto> {
  return await api<CycleBenefitDto>("membership", `/membership/benefits/current`, {
    method: "GET",
    params: { userId },
    withAuth: true,
    cache: "no-store",
  })
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
  const result = await api<PlanWithTier[]>("membership", `plans`, {
    method: "GET",
    withAuth: false,
    cache: "no-store",
  })
  return result
}

/**
 * 멤버십 구독 생성
 */
export async function createSubscriptionServer(planId: string) {
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
      withAuth: false,
      cache: "no-store",
    }
  )
}

/**
 * 멤버십 구독 생성
 * @param planId 선택한 플랜 ID
 */
