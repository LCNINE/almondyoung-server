import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

import { medusaSignin } from "@lib/api/medusa/signin"

const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

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
  if (!hasAccess) {
    // 로그인 안 한 채로 sync 라우트 직접 호출 — 그냥 next 로 보냄
    return NextResponse.redirect(target, {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    })
  }

  try {
    const result = await medusaSignin()
    if (!result.success) {
      console.error("[sync-medusa] medusaSignin failed", result)
    }
  } catch (e) {
    // fail-open: sync 실패해도 사용자 흐름을 막지 않는다 (다음 진입에서 재시도됨)
    console.error("[sync-medusa] unexpected error", e)
  }

  return NextResponse.redirect(target, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  })
}
