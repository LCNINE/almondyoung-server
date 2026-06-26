"use server"

import { revalidatePath } from "next/cache"

import { api } from "../api"
import { ApiAuthError, ApiNetworkError, HttpApiError } from "../api-error"
import type {
  OwnershipFilter,
  OwnershipListResponseDto,
  OwnershipResponseDto,
} from "@lib/types/dto/library.dto"

/**
 * Core 의 `/library/ownerships` 목록 호출. revokedAt IS NULL 만 노출됨 (서버 측 보장).
 *
 * @param skip / take — pagination
 * @param filter — "all" | "new" | "used"
 */
export const getOwnerships = async ({
  skip,
  take,
  filter,
}: {
  skip: number
  take: number
  filter?: OwnershipFilter
}): Promise<OwnershipListResponseDto> => {
  const params: Record<string, string> = {
    skip: String(skip),
    take: String(take),
  }
  if (filter) params.filter = filter

  return api<OwnershipListResponseDto>("library", `/library/ownerships`, {
    method: "GET",
    withAuth: true,
    params,
  })
}

/**
 * 본인 ownership 사용 처리. 멱등 — 이미 exercise 된 경우도 성공으로 떨어진다.
 * 성공 시 다운로드 페이지 캐시 무효화.
 */
export const exerciseOwnership = async (
  ownershipId: string
): Promise<{ success: true; data: OwnershipResponseDto } | { success: false; message: string }> => {
  try {
    const data = await api<OwnershipResponseDto>(
      "library",
      `/library/ownerships/${ownershipId}/exercise`,
      {
        method: "POST",
        withAuth: true,
      }
    )

    revalidatePath("/[countryCode]/mypage/download", "page")

    return { success: true, data }
  } catch (err) {
    if (err instanceof ApiAuthError) {
      // error.tsx 의 토큰 복구로 전파
      throw err
    }
    const message =
      err instanceof HttpApiError || err instanceof ApiNetworkError
        ? err.message
        : "라이센스 사용 처리에 실패했습니다."
    return { success: false, message }
  }
}

/**
 * 본인 ownership 의 다운로드 URL(S3 signed URL, 강제 다운로드 disposition 포함)을 받아 반환한다.
 * 파일 바이트를 서버액션으로 프록시하면 대용량 파일이 Lambda 응답한도(6MB)를 넘겨 502 가 나므로,
 * Core 가 signed URL 만 주고 브라우저가 S3 에서 직접 받는다.
 */
export const downloadOwnership = async (
  ownershipId: string
): Promise<
  | { success: true; url: string; filename: string }
  | { success: false; message: string }
> => {
  try {
    const data = await api<{ url: string; filename: string }>(
      "library",
      `/library/ownerships/${ownershipId}/download`,
      { method: "GET", withAuth: true }
    )
    return { success: true, url: data.url, filename: data.filename }
  } catch (err) {
    if (err instanceof ApiAuthError) throw err
    const message =
      err instanceof HttpApiError || err instanceof ApiNetworkError
        ? err.message
        : "라이센스 다운로드에 실패했습니다."
    return { success: false, message }
  }
}
