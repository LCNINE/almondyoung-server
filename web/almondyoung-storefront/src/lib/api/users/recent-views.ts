"use server"

import { RecentViewDto } from "@lib/types/dto/users"
import { api } from "../api"

/**
 * 최근 본 상품 추가
 */
export async function addToRecentViews(
  productId: string
): Promise<RecentViewDto> {
  const data = await api<RecentViewDto>("users", "/recent-views", {
    method: "POST",
    withAuth: true,
    body: { productId },
  })

  return data
}

/**
 * 최근 본 상품 목록 조회
 */
export async function getRecentViews(
  limit: number = 10
): Promise<RecentViewDto[]> {
  const data = await api<RecentViewDto[]>("users", "/recent-views", {
    method: "GET",
    withAuth: true,
    params: {
      limit: limit.toString(),
    },
  })

  return data
}

/**
 * 최근 본 상품 제거
 */
export async function removeFromRecentViews(
  recentViewId: string
): Promise<{ success: boolean; message: string }> {
  const data = await api<{ success: boolean; message: string }>(
    "users",
    `/recent-views/${recentViewId}`,
    {
      method: "DELETE",
      withAuth: true,
    }
  )

  return data
}
