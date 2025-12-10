import { NextRequest, NextResponse } from "next/server"

const BACKEND_BASE_URL = process.env.BACKEND_URL

// ==========================================
// 1. 공통 헬퍼 함수 (중복 제거용)
// ==========================================

// 토큰 헤더 생성기
async function getAuthHeaders(request: NextRequest) {
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

// 백엔드 URL 생성기
async function buildBackendUrl(
  request: NextRequest,
  params: Promise<{ path: string[] }>
) {
  const { path } = await params
  const pathString = path.join("/")
  const searchParams = request.nextUrl.search
  // 기존 users 경로 처리
  return `${BACKEND_BASE_URL}/users/${pathString}${searchParams}`
}

// 응답 처리기 (에러 포워딩 포함)
async function processResponse(backendResponse: Response) {
  const data = await backendResponse.json().catch(() => null)

  // 백엔드 에러가 났을 때 내용을 감추지 않고 보여줌
  if (!backendResponse.ok) {
    return NextResponse.json(data || { error: "Unknown Backend Error" }, {
      status: backendResponse.status,
    })
  }

  return NextResponse.json(data, { status: backendResponse.status })
}

// ==========================================
// 2. 메서드별 핸들러 (분리됨)
// ==========================================

/**
 * GET 핸들러
 * - Body 처리가 없어서 아주 심플함
 */
export async function GET(request: NextRequest, { params }: any) {
  try {
    const url = await buildBackendUrl(request, params)
    const headers = await getAuthHeaders(request)

    const res = await fetch(url, {
      method: "GET",
      headers: headers,
      cache: "no-store",
    })

    return processResponse(res)
  } catch (error) {
    return NextResponse.json({ error: "Proxy GET Error" }, { status: 500 })
  }
}

/**
 * POST / PUT / PATCH 핸들러
 * - Body(JSON, FormData) 처리가 핵심
 */
export async function POST(request: NextRequest, { params }: any) {
  return handleMutation("POST", request, params)
}

export async function PUT(request: NextRequest, { params }: any) {
  return handleMutation("PUT", request, params)
}

export async function PATCH(request: NextRequest, { params }: any) {
  return handleMutation("PATCH", request, params)
}

// Mutation 공통 로직 (POST, PUT, PATCH가 공유)
async function handleMutation(
  method: string,
  request: NextRequest,
  params: any
) {
  try {
    const url = await buildBackendUrl(request, params)
    const headers = await getAuthHeaders(request)

    const contentType = request.headers.get("content-type")
    let body: any

    // 🚨 중요: Content-Type별 처리 분리
    if (contentType?.includes("application/json")) {
      // JSON이면 헤더 명시 + Stringify
      headers["Content-Type"] = "application/json"
      const json = await request.json()
      body = JSON.stringify(json)
    } else if (contentType?.includes("multipart/form-data")) {
      // 🚨 FormData면 'Content-Type' 헤더를 절대 설정하면 안 됨 (fetch가 자동 설정)
      // headers["Content-Type"] = ... (생략해야 함)
      body = await request.formData()
    } else {
      // 그 외 (text 등)
      body = await request.text()
    }

    const res = await fetch(url, {
      method: method,
      headers: headers,
      body: body,
      cache: "no-store",
    })

    return processResponse(res)
  } catch (error) {
    console.error(`Proxy ${method} Error:`, error)
    return NextResponse.json(
      { error: `Proxy ${method} Error` },
      { status: 500 }
    )
  }
}

/**
 * DELETE 핸들러
 */
export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const url = await buildBackendUrl(request, params)
    const headers = await getAuthHeaders(request)

    const res = await fetch(url, {
      method: "DELETE",
      headers: headers,
      cache: "no-store",
    })

    return processResponse(res)
  } catch (error) {
    return NextResponse.json({ error: "Proxy DELETE Error" }, { status: 500 })
  }
}
