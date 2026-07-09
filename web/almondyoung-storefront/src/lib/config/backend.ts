export type BackendService =
  | "channelAdapter"
  | "fs"
  | "library"
  | "medusa"
  | "membership"
  | "notification"
  | "pim"
  | "search"
  | "users"
  | "wallet"
  | "wms"
  | "anly"
  | "ugc"

const SERVICE_SUBDOMAINS: Record<BackendService, string> = {
  users: "user",
  wms: "core",
  channelAdapter: "channel-adapter",
  fs: "file",
  library: "core",
  medusa: "medusa",
  membership: "membership",
  notification: "notification",
  pim: "core",
  search: "search",
  wallet: "wallet",
  anly: "analytics",
  ugc: "ugc",
}

const LEGACY_SERVICE_PATHS: Record<BackendService, string> = {
  users: "users",
  wms: "wms",
  channelAdapter: "channel-adapter",
  fs: "fs",
  library: "pim",
  medusa: "medusa",
  membership: "membership",
  notification: "notification",
  pim: "pim",
  search: "search",
  wallet: "wallet",
  anly: "anly",
  ugc: "ugc",
}

// docs/local-dev.md 의 로컬 포트맵과 동일하게 유지할 것
const LOCAL_SERVICE_URLS: Record<BackendService, string> = {
  users: "http://localhost:3000", // user-service
  wms: "http://localhost:3100", // core (pim+wms 통합)
  channelAdapter: "http://localhost:3003",
  fs: "http://localhost:3010", // file-service
  library: "http://localhost:3100", // core (라이브러리 모듈)
  medusa: "http://localhost:9000",
  membership: "http://localhost:3001",
  notification: "http://localhost:3050",
  pim: "http://localhost:3100", // core (pim+wms 통합)
  search: "http://localhost:3060",
  wallet: "http://localhost:5001",
  anly: "http://localhost:3040",
  ugc: "http://localhost:3030",
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "")

const normalizeDomain = (value: string) =>
  trimTrailingSlash(value.replace(/^https?:\/\//, ""))

export const isRailwayBackend = () =>
  process.env.NEXT_PUBLIC_USE_RAILWAY_BACKEND === "true" ||
  process.env.USE_RAILWAY_BACKEND === "true"

const getBackendDomain = () => {
  const isServer = typeof window === "undefined"
  const rawDomain = isServer
    ? process.env.BACKEND_DOMAIN
    : process.env.NEXT_PUBLIC_BACKEND_DOMAIN

  if (!rawDomain) return undefined

  return normalizeDomain(rawDomain)
}
const getLegacyGatewayBaseUrl = (service: BackendService) => {
  const isServer = typeof window === "undefined"
  const legacyBase = isServer
    ? process.env.BACKEND_URL
    : process.env.NEXT_PUBLIC_BACKEND_URL

  if (!legacyBase) return undefined

  const base = trimTrailingSlash(legacyBase)
  return `${base}/${LEGACY_SERVICE_PATHS[service]}`
}

export const getBackendBaseUrl = (service: BackendService) => {
  if (!isRailwayBackend()) {
    // 로컬 file-service 데모셋에 없는 이미지를 라이브 fs 에서 읽고 싶을 때 override.
    // 예: NEXT_PUBLIC_FS_BASE_URL=https://file.almondyoung-next.com
    if (service === "fs" && process.env.NEXT_PUBLIC_FS_BASE_URL) {
      return trimTrailingSlash(process.env.NEXT_PUBLIC_FS_BASE_URL)
    }
    return LOCAL_SERVICE_URLS[service]
  }

  const domain = getBackendDomain()

  if (domain) {
    return `https://${SERVICE_SUBDOMAINS[service]}.${domain}`
  }

  return getLegacyGatewayBaseUrl(service)
}

export const requireBackendBaseUrl = (service: BackendService) => {
  const baseUrl = getBackendBaseUrl(service)

  if (!baseUrl) {
    throw new Error(
      `[backend] Missing BACKEND_DOMAIN/NEXT_PUBLIC_BACKEND_DOMAIN for ${service}.`
    )
  }

  return baseUrl
}
