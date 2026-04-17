import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios"

/**
 * 서비스 이름 → 프로덕션 서브도메인 / 로컬 개발 포트 매핑
 *
 * 프로덕션: https://{subdomain}.{VITE_BASE_DOMAIN}
 * 개발:     http://localhost:{devPort}
 */
// df 환경: pim/wms는 almondyoung-server(api)에 흡수됨. membership/notification/ugc는 미배포.
const SERVICE_MAP = {
  pim: { subdomain: "api", devPort: 3000 },
  wms: { subdomain: "api", devPort: 3000 },
  api: { subdomain: "api", devPort: 3000 },
  user: { subdomain: "user", devPort: 3030 },
  wallet: { subdomain: "wallet", devPort: 3040 },
  channel: { subdomain: "channel-adapter", devPort: 3070 },
  file: { subdomain: "file", devPort: 3080 },
} as const

export type ServiceName = keyof typeof SERVICE_MAP

function getBaseURL(service: ServiceName): string {
  const { subdomain, devPort } = SERVICE_MAP[service]

  const baseDomain = import.meta.env.VITE_BASE_DOMAIN as string | undefined
  if (baseDomain) {
    return `https://${subdomain}.${baseDomain}`
  }

  // 브라우저 origin에서 base domain 추출 (e.g. admin.almondyoung.com → almondyoung.com)
  const { hostname, protocol } = window.location
  const parts = hostname.split(".")
  if (parts.length >= 3) {
    const domain = parts.slice(1).join(".")
    return `${protocol}//${subdomain}.${domain}`
  }

  // localhost 등 개발 환경
  return `http://localhost:${devPort}`
}

export const SESSION_EXPIRED_EVENT = "auth:session-expired"

interface RetryConfig extends InternalAxiosRequestConfig {
  retry?: number
  retryDelay?: number
  _retry?: boolean
  _skipAuthRefresh?: boolean
}

const RETRY_DEFAULTS = { retry: 2, retryDelay: 1000 }

// 토큰 리프레시 동시성 제어
let isRefreshing = false
let refreshSubscribers: Array<(ok: boolean) => void> = []

function notifyRefreshDone(ok: boolean) {
  const subs = refreshSubscribers
  refreshSubscribers = []
  subs.forEach((cb) => cb(ok))
}

function waitForRefresh(): Promise<boolean> {
  return new Promise((resolve) => refreshSubscribers.push(resolve))
}

async function callRestoreToken(): Promise<boolean> {
  // axios 인터셉터 재진입을 피하기 위해 raw fetch 사용
  try {
    const res = await fetch(`${getBaseURL("user")}/auth/restore-token`, {
      method: "POST",
      credentials: "include",
    })
    return res.ok
  } catch {
    return false
  }
}

function applyAuthInterceptor(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => response,
    async (err: AxiosError) => {
      const config = err.config as RetryConfig | undefined
      if (!config || config._skipAuthRefresh) return Promise.reject(err)

      if (err.response?.status !== 401 || config._retry) {
        return Promise.reject(err)
      }

      config._retry = true

      // 이미 다른 요청이 리프레시 중이면 결과를 기다림
      if (isRefreshing) {
        const ok = await waitForRefresh()
        if (!ok) return Promise.reject(err)
        return instance(config)
      }

      isRefreshing = true
      const ok = await callRestoreToken()
      isRefreshing = false
      notifyRefreshDone(ok)

      if (!ok) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
        }
        return Promise.reject(err)
      }

      return instance(config)
    },
  )
}

function applyRetryInterceptor(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => response,
    async (err: AxiosError) => {
      const config = err.config as RetryConfig | undefined
      if (!config) return Promise.reject(err)

      // 401은 auth 인터셉터에서만 처리 (네트워크 retry 대상 아님)
      if (err.response?.status === 401) return Promise.reject(err)

      if (config.retry === undefined) {
        config.retry = RETRY_DEFAULTS.retry
        config.retryDelay = RETRY_DEFAULTS.retryDelay
      }

      if (config.retry <= 0) return Promise.reject(err)

      config.retry -= 1

      await new Promise((r) => setTimeout(r, config.retryDelay || 1000))
      return instance(config)
    },
  )
}

const clients = new Map<ServiceName, AxiosInstance>()

export function getServiceClient(service: ServiceName): AxiosInstance {
  const existing = clients.get(service)
  if (existing) return existing

  const instance = axios.create({
    baseURL: getBaseURL(service),
    headers: { "Content-Type": "application/json" },
    withCredentials: true,
  })

  // 응답 인터셉터는 등록 순서대로 실행된다.
  // retry가 먼저 — 401은 통과시키고, 401이 아닌 네트워크 에러만 재시도.
  // auth가 그 다음 — 통과된 401을 잡아 리프레시 후 원 요청 재실행.
  applyRetryInterceptor(instance)
  applyAuthInterceptor(instance)
  clients.set(service, instance)

  return instance
}

/** 하위 호환용 — 기본 PIM 클라이언트 */
export const client = getServiceClient("pim")
