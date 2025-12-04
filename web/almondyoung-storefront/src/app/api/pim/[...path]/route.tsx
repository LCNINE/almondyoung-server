import { NextRequest } from "next/server"
import {
  getAuthHeaders,
  buildBackendUrl,
  processResponse,
} from "@lib/api/route-handlers/pim-handler"

/**
 * PIM API Route Handler
 * GET 요청만 지원 (PIM API는 읽기 전용)
 */

/**
 * GET 핸들러
 * - PIM API는 GET 요청만 필요
 * - 백엔드 응답의 status를 그대로 전달 (400, 401, 404, 500 등)
 * - fetch 자체가 실패한 경우에만 500 반환
 */
export async function GET(request: NextRequest, { params }: any) {
  try {
    const url = await buildBackendUrl(request, params)
    const headers = await getAuthHeaders(request)

    const res = await fetch(url, {
      method: "GET",
      headers: headers,
      cache: "no-store",
      credentials: "include",
    })

    return processResponse(res)
  } catch (error) {
    // fetch 자체가 실패한 경우에만 500 반환
    console.error("[PIM Route Handler] Fetch error:", error)
    return NextResponse.json(
      { error: "Proxy GET Error" },
      { status: 500 }
    )
  }
}
