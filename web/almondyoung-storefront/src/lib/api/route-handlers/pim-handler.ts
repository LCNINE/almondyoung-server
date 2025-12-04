import { NextRequest, NextResponse } from "next/server"

const BACKEND_BASE_URL = process.env.BACKEND_URL

/**
 * PIM API Route Handler 공통 헬퍼 함수
 * GET 요청만 지원하는 PIM API를 위한 헬퍼 함수들
 */

/**
 * 인증 헤더 생성
 * 쿠키를 통째로 백엔드에 전달하여 JWT 토큰 인증 처리
 */
export async function getAuthHeaders(request: NextRequest): Promise<HeadersInit> {
  const headers: HeadersInit = {}

  // ✅ 쿠키를 통째로 전달
  const rawCookie = request.headers.get("cookie") || ""

  if (rawCookie) {
    headers["Cookie"] = rawCookie
  }

  // 클라이언트의 Accept 헤더 등 기타 필요한 헤더 전달
  if (request.headers.get("accept")) {
    headers["Accept"] = request.headers.get("accept")!
  }

  return headers
}

/**
 * 백엔드 URL 생성
 * PIM API 경로를 백엔드 URL로 변환
 */
export async function buildBackendUrl(
  request: NextRequest,
  params: Promise<{ path: string[] }>
): Promise<string> {
  const { path } = await params
  const pathString = path.join("/")
  const searchParams = request.nextUrl.search
  return `${BACKEND_BASE_URL}/pim/${pathString}${searchParams}`
}

/**
 * 응답 처리
 * 백엔드 응답을 그대로 전달 (에러 포함, status 코드 유지)
 */
export async function processResponse(backendResponse: Response): Promise<NextResponse> {
  const data = await backendResponse.json().catch(() => null)

  // 백엔드 에러가 났을 때 내용을 감추지 않고 보여줌
  // 백엔드 응답의 status를 그대로 전달 (400, 401, 404, 500 등)
  if (!backendResponse.ok) {
    return NextResponse.json(data || { error: "Unknown Backend Error" }, {
      status: backendResponse.status,
    })
  }

  return NextResponse.json(data, { status: backendResponse.status })
}

