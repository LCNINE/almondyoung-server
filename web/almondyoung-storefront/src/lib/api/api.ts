import { getAccessToken, getCookies } from "@lib/data/cookies"
import { ApiAuthError, ApiNetworkError, HttpApiError } from "./api-error"
import {
  getBackendBaseUrl,
  type BackendService,
} from "@/lib/config/backend"

/**
 * server action response type
 * 이 타입을 사용해야 프론트단에서 래핑된 에러를 처리할 수 있습니다.
 */
export type ApiResponse<T> =
  | { success?: boolean; data: T }
  | { success?: false; error: { message: string; status: number } }

type ServiceType = BackendService
type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown
  params?: Record<string, string>
  withAuth?: boolean // 인증이 필요한 요청인지 여부
  next?: {
    revalidate?: number | false
    tags?: string[]
  }
}

export async function api<T>(
  service: ServiceType,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, params, withAuth = true, next, ...init } = options

  const baseUrl = getBackendBaseUrl(service)

  if (!baseUrl) {
    throw new ApiNetworkError(
      `Missing backend base URL for service: ${service}`,
      500,
      "BACKEND_DOMAIN_MISSING"
    )
  }
  const fullUrl = params
    ? `${baseUrl}${path}?${new URLSearchParams(params)}`
    : `${baseUrl}${path}`

  const isFormData = body instanceof FormData

  const headers: HeadersInit = {
    ...init.headers,
  }

  // body가 있고 FormData가 아닐 때만 Content-Type 설정
  if (body && !isFormData) {
    ;(headers as Record<string, string>)["Content-Type"] = "application/json"
  }

  if (withAuth) {
    const cookieString = await getCookies()
    const authHeaders = await getAccessToken()

    // 쿠키에 jwt 토큰이 없는데도 _medusa_cache_id가 담겨있어서 api요청이 가능한 경우를 방지하고자 추가함
    if (!authHeaders) {
      throw new ApiAuthError("UNAUTHORIZED", 401, "UNAUTHORIZED")
    }

    ;(headers as Record<string, string>).Cookie = cookieString
  }

  let response: Response

  try {
    response = await fetch(fullUrl, {
      ...init,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      // Next.js 캐싱 옵션 전달
      ...(next && { next }),
      // 서버 사이드에서만 캐싱 적용 (클라이언트에서는 작동하지 않음)
      ...(typeof window === "undefined" && next?.tags
        ? { cache: "force-cache" }
        : {}),
    })
  } catch {
    // 서버 액션에서만 쓸 거면 네트워크 에러 날 일이 거의 없긴 한데, 백엔드 서버가 죽어있거나 URL 잘못됐을 때 대비용으로 넣어둠
    throw new ApiNetworkError("NETWORK_ERROR", 500, "NETWORK_ERROR")
  }

  if (response.ok) {
    const json = await response.json()

    //Pagination 응답 (data, total, page, limit이 모두 있으면) 전체 반환
    if (
      json &&
      typeof json === "object" &&
      "data" in json &&
      "total" in json &&
      "page" in json &&
      "limit" in json
    ) {
      return json // Pagination 응답은 전체 반환
    }

    if (json && typeof json === "object" && "data" in json) {
      return json.data
    }

    return json
  }

  const errorData = await response.json().catch(() => ({})) // response.json()이 실패하면 빈 객체 반환, 크게 상관 없는 에러임
  // console.log("errorData", errorData)

  if (response.status === 401) {
    throw new ApiAuthError(
      errorData.message ?? "인증이 필요합니다",
      401,
      "UNAUTHORIZED"
    )
  }

  if (response.status === 403) {
    throw new HttpApiError(
      errorData.message ?? "권한이 없습니다",
      403,
      "FORBIDDEN",
      errorData
    )
  }

  throw new HttpApiError(
    errorData.message ?? `요청 실패: ${response.status}`,
    response.status,
    response.statusText,
    errorData
  )
}
