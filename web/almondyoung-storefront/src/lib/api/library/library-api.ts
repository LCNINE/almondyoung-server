"use server"

import { getAccessToken, getCookies } from "@lib/data/cookies"
import { revalidatePath } from "next/cache"

import { api } from "../api"
import { ApiAuthError, ApiNetworkError, HttpApiError } from "../api-error"
import {
  requireBackendBaseUrl,
} from "@/lib/config/backend"
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
 * 본인 ownership 의 파일을 binary stream 으로 받아 (filename, mimeType, bytes) 반환.
 *
 * api() 는 JSON 만 다루므로 raw fetch 를 사용. 인증/쿠키는 동일하게 부착.
 * Content-Disposition 의 RFC 5987 `filename*=UTF-8''...` 파라미터를 우선 디코드.
 */
export const downloadOwnership = async (
  ownershipId: string
): Promise<
  | {
      success: true
      filename: string
      mimeType: string
      // Server Action 의 한계로 bytes 는 base64 로 직렬화해 넘긴다 (Buffer 직접 반환 불가).
      base64: string
    }
  | { success: false; message: string }
> => {
  try {
    const baseUrl = requireBackendBaseUrl("library")
    const cookieString = await getCookies()
    const accessToken = await getAccessToken()
    if (!accessToken) {
      throw new ApiAuthError("UNAUTHORIZED", 401, "UNAUTHORIZED")
    }

    const res = await fetch(`${baseUrl}/library/ownerships/${ownershipId}/download`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Cookie: cookieString,
      },
    })

    if (!res.ok) {
      if (res.status === 401) {
        throw new ApiAuthError("UNAUTHORIZED", 401, "UNAUTHORIZED")
      }
      const errBody = await res.text().catch(() => "")
      return {
        success: false,
        message: errBody || `다운로드 실패: ${res.status}`,
      }
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream"
    const filename = parseContentDispositionFilename(
      res.headers.get("content-disposition")
    )

    const arrayBuffer = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")

    return { success: true, filename, mimeType: contentType, base64 }
  } catch (err) {
    if (err instanceof ApiAuthError) throw err
    const message =
      err instanceof Error ? err.message : "라이센스 다운로드에 실패했습니다."
    return { success: false, message }
  }
}

/**
 * Content-Disposition 파싱.
 * 우선순위: `filename*=UTF-8''<encoded>` > `filename="..."` > `download`.
 */
function parseContentDispositionFilename(header: string | null): string {
  if (!header) return "download"

  const starMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1].trim())
    } catch {
      // fall through to ascii fallback
    }
  }

  const quotedMatch = header.match(/filename\s*=\s*"([^"]+)"/i)
  if (quotedMatch) return quotedMatch[1]

  const bareMatch = header.match(/filename\s*=\s*([^;]+)/i)
  if (bareMatch) return bareMatch[1].trim()

  return "download"
}
