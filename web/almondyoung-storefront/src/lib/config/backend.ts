export type BackendService =
  | "channelAdapter"
  | "fs"
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
  wms: "almond",
  channelAdapter: "channel-adapter",
  fs: "file",
  medusa: "medusa",
  membership: "membership",
  notification: "notification",
  pim: "almond",
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
  medusa: "medusa",
  membership: "membership",
  notification: "notification",
  pim: "pim",
  search: "search",
  wallet: "wallet",
  anly: "anly",
  ugc: "ugc",
}

const LOCAL_SERVICE_URLS: Record<BackendService, string> = {
  users: "http://localhost:3030", // user-service
  wms: "http://localhost:3000", // almondyoung-server (pim+wms 통합)
  channelAdapter: "http://localhost:3003",
  fs: "http://localhost:3000", // file-service
  medusa: "http://localhost:8080",
  membership: "http://localhost:3001",
  notification: "http://localhost:5001",
  pim: "http://localhost:3000", // almondyoung-server (pim+wms 통합)
  search: "http://localhost:3004",
  wallet: "http://localhost:5001",
  anly: "http://localhost:3040",
  ugc: "http://localhost:3031",
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
