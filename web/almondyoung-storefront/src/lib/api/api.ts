import { getAccessToken, getCookies } from "@lib/data/cookies"
import { ApiAuthError, ApiNetworkError, HttpApiError } from "./api-error"

type ServiceType =
  | "channelAdapter"
  | "fs"
  | "medusa"
  | "membership"
  | "notification"
  | "pim"
  | "users"
  | "wallet"
  | "wms"

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown
  params?: Record<string, string>
  withAuth?: boolean // 인증이 필요한 요청인지 여부
}

const getBaseUrl = (service: ServiceType) => {
  if (process.env.USE_RAILWAY_BACKEND === "true") {
    const serviceUrls: Record<ServiceType, string> = {
      users: `${process.env.BACKEND_URL}/users`,
      wms: `${process.env.BACKEND_URL}/wms`,
      channelAdapter: `${process.env.BACKEND_URL}/channel-adapter`,
      fs: `${process.env.BACKEND_URL}/fs`,
      medusa: `${process.env.BACKEND_URL}/medusa`,
      membership: `${process.env.BACKEND_URL}/membership`,
      notification: `${process.env.BACKEND_URL}/notification`,
      pim: `${process.env.BACKEND_URL}/pim`,
      wallet: `${process.env.BACKEND_URL}/wallet`,
    }
    return serviceUrls[service]
  }

  // 기본값은 로컬 (USE_RAILWAY_BACKEND가 false거나 env 없을 때)
  const localUrls: Record<ServiceType, string> = {
    users: "http://localhost:3030", // user-service
    wms: "http://localhost:3010",
    channelAdapter: "http://localhost:3003",
    fs: "http://localhost:3000", // file-service
    medusa: "http://localhost:9000",
    membership: "http://localhost:3001",
    notification: "http://localhost:5001",
    pim: "http://localhost:3020",
    wallet: "http://localhost:5000",
  }

  return localUrls[service]
}

export async function api<T>(
  service: ServiceType,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, params, withAuth = true, ...init } = options

  const baseUrl = getBaseUrl(service)
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
    })
  } catch {
    // 서버 액션에서만 쓸 거면 네트워크 에러 날 일이 거의 없긴 한데, 백엔드 서버가 죽어있거나 URL 잘못됐을 때 대비용으로 넣어둠
    throw new ApiNetworkError("NETWORK_ERROR", 500, "NETWORK_ERROR")
  }

  if (response.ok) {
    const json = await response.json()

    // data 필드가 있으면 풀어서 반환 (null 포함)
    if (json && typeof json === "object" && "data" in json) {
      return json.data
    }

    return json
  }

  const errorData = await response.json().catch(() => ({})) // response.json()이 실패하면 빈 객체 반환, 크게 상관 없는 에러임

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
