"use server"

import { revalidateTag } from "next/cache"
import { ApiAuthError, HttpApiError } from "@/lib/api/api-error"
import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import {
  LOGO_CONTEST_TAG,
  CreateLogoContestEntryDto,
  LogoContestEntryDto,
  LogoContestSort,
  LogoContestStatusDto,
  MyLogoContestStateDto,
} from "@/lib/types/dto/logo-contest"
import { api } from "../api"

export const getLogoContestStatus = async (): Promise<LogoContestStatusDto> =>
  await api("ugc", `/logo-contest/status`, {
    method: "GET",
    withAuth: false,
    cache: "no-store",
  })

export const listLogoContestEntries = async ({
  sort = "latest",
  page = 1,
  limit = 24,
}: {
  sort?: LogoContestSort
  page?: number
  limit?: number
}): Promise<PaginatedResponseDto<LogoContestEntryDto>> =>
  await api("ugc", `/logo-contest/entries`, {
    method: "GET",
    params: { sort, page: String(page), limit: String(limit) },
    withAuth: false,
    cache: "no-store",
  })

/** 메인 섹션용 득표 상위 10개. 전 방문자가 보는 자리라 5분 캐시한다. */
export const listTopLogoContestEntries = async (): Promise<
  LogoContestEntryDto[]
> =>
  await api("ugc", `/logo-contest/entries/top`, {
    method: "GET",
    withAuth: false,
    next: { tags: [LOGO_CONTEST_TAG], revalidate: 300 },
  })

export const getLogoContestEntry = async (
  id: string
): Promise<LogoContestEntryDto> =>
  await api("ugc", `/logo-contest/entries/${id}`, {
    method: "GET",
    withAuth: false,
    cache: "no-store",
  })

export const getMyLogoContestState =
  async (): Promise<MyLogoContestStateDto> =>
    await api("ugc", `/logo-contest/me`, {
      method: "GET",
      withAuth: true,
      cache: "no-store",
    })

/**
 * 거절 사유는 값으로 돌려준다 — 서버 액션이 던진 에러는 프로덕션에서 메시지가 지워져
 * 클라이언트가 「이미 투표했어요」와 「자기 작품이에요」를 구분할 수 없다.
 *
 * 401/403 은 여기서 잡지 않는다. error.tsx 가 토큰 복구를 하는 경로이기 때문이다.
 */
export type LogoContestActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "conflict" | "rejected"; message: string }

const toResult = <T>(error: unknown): LogoContestActionResult<T> => {
  if (error instanceof ApiAuthError) throw error
  if (error instanceof HttpApiError) {
    if (error.status === 401 || error.status === 403) throw error
    return {
      ok: false,
      reason: error.status === 409 ? "conflict" : "rejected",
      message: error.message,
    }
  }
  throw error
}

export const createLogoContestEntry = async (
  dto: CreateLogoContestEntryDto
): Promise<LogoContestActionResult<LogoContestEntryDto>> => {
  try {
    const data = await api<LogoContestEntryDto>("ugc", `/logo-contest/entries`, {
      method: "POST",
      body: dto,
      withAuth: true,
    })
    revalidateTag(LOGO_CONTEST_TAG)
    return { ok: true, data }
  } catch (error) {
    return toResult(error)
  }
}

export const deleteLogoContestEntry = async (
  id: string
): Promise<LogoContestActionResult<null>> => {
  try {
    await api("ugc", `/logo-contest/entries/${id}`, {
      method: "DELETE",
      withAuth: true,
    })
    revalidateTag(LOGO_CONTEST_TAG)
    return { ok: true, data: null }
  } catch (error) {
    return toResult(error)
  }
}

export const voteLogoContestEntry = async (
  id: string
): Promise<LogoContestActionResult<{ voteCount: number }>> => {
  try {
    const data = await api<{ voteCount: number }>(
      "ugc",
      `/logo-contest/entries/${id}/vote`,
      { method: "POST", withAuth: true }
    )
    revalidateTag(LOGO_CONTEST_TAG)
    return { ok: true, data }
  } catch (error) {
    return toResult(error)
  }
}

export const unvoteLogoContestEntry = async (
  id: string
): Promise<LogoContestActionResult<{ voteCount: number }>> => {
  try {
    const data = await api<{ voteCount: number }>(
      "ugc",
      `/logo-contest/entries/${id}/vote`,
      { method: "DELETE", withAuth: true }
    )
    revalidateTag(LOGO_CONTEST_TAG)
    return { ok: true, data }
  } catch (error) {
    return toResult(error)
  }
}
