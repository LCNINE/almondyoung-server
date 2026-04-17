import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
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

interface RetryConfig extends AxiosRequestConfig {
  retry: number
  retryDelay: number
}

const RETRY_DEFAULTS = { retry: 2, retryDelay: 1000 }

function applyRetryInterceptor(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => response,
    async (err: AxiosError) => {
      const config = err.config as RetryConfig | undefined
      if (!config) return Promise.reject(err)

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

  applyRetryInterceptor(instance)
  clients.set(service, instance)

  return instance
}

/** 하위 호환용 — 기본 PIM 클라이언트 */
export const client = getServiceClient("pim")
