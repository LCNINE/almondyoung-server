import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

import { medusaSignin } from "@lib/api/medusa/signin"

const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

// 한 번 시도했음을 표시하는 마커 쿠키. 짧은 TTL 동안 sync 게이트를 우회시켜
// medusaSignin 실패 시 무한 루프(/ ↔ /api/auth/sync-medusa) 를 차단한다.
// _medusa_jwt 가 정상 set 되면 의미 없음 — 실패 폴백 전용.
const SYNC_TRIED_COOKIE = "_medusa_sync_tried"
const SYNC_TRIED_TTL_SECONDS = 30

/**
 * `next` 파라미터를 안전하게 정규화한다.
 * - 동일 origin (request host) 인 경우 path+search 만 추출
 * - "/" 로 시작하는 path 는 그대로 사용
 * - 그 외(외부 호스트/잘못된 값) 는 기본 리전 홈으로 fallback
 *
 * open redirect 방지가 목적.
 */
function normalizeNext(rawNext: string | null, request: NextRequest): string {
  const fallback = `/${DEFAULT_REGION}`
  if (!rawNext) return fallback

  if (rawNext.startsWith("/") && !rawNext.startsWith("//")) {
    return rawNext
  }

  try {
    const u = new URL(rawNext)
    if (u.host === request.nextUrl.host) {
      return `${u.pathname}${u.search}`
    }
  } catch {
    // fall through to fallback
  }

  return fallback
}

export async function GET(request: NextRequest) {
  const next = normalizeNext(request.nextUrl.searchParams.get("next"), request)
  const target = new URL(next, request.nextUrl.origin)

  const jar = await cookies()
  const hasAccess = !!jar.get("accessToken")?.value
  const hasRefresh = !!jar.get("refreshToken")?.value
  const hadMedusaJwt = !!jar.get("_medusa_jwt")?.value

  console.info("[sync-medusa] enter", {
    next,
    hasAccess,
    hasRefresh,
    hadMedusaJwt,
  })

  if (!hasAccess) {
    console.info("[sync-medusa] no accessToken — skip signin, redirect to next")
    return buildRedirectWithMarker(target)
  }

  try {
    const result = await medusaSignin()
    if (!result.success) {
      console.error("[sync-medusa] medusaSignin failed", {
        error: result.error,
        code: result.code,
        message: result.message,
      })
    } else {
      console.info("[sync-medusa] medusaSignin success", {
        tokenLen: result.data?.length ?? 0,
      })
    }
  } catch (e) {
    console.error("[sync-medusa] medusaSignin threw", {
      name: (e as Error)?.name,
      message: (e as Error)?.message,
      stack: (e as Error)?.stack,
    })
  }

  // jwt 가 set 됐는지 사후 확인 (cookies() 는 같은 요청 내에서 mutation 반영됨)
  const hasMedusaJwtAfter = !!(await cookies()).get("_medusa_jwt")?.value
  console.info("[sync-medusa] exit", {
    hasMedusaJwtAfter,
    redirectTo: target.toString(),
  })

  return buildRedirectWithMarker(target)
}

function buildRedirectWithMarker(target: URL): NextResponse {
  const res = NextResponse.redirect(target, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  })
  // 성공/실패와 무관하게 마커를 set — 실패 시 미들웨어 루프 차단용.
  // 성공 시에는 _medusa_jwt 가 있으므로 미들웨어가 이미 게이트를 안 탄다.
  res.cookies.set(SYNC_TRIED_COOKIE, "1", {
    maxAge: SYNC_TRIED_TTL_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  })
  return res
}
