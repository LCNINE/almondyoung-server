// 순수 규칙 — next·server-only 를 import 하지 않는다(루트 jest 가 scripts/tenancy 에서 이 파일을 직접 잰다).

/** user-service 가 auth-web 에만(내부 secret) 주는 «주소 → 테넌트» 조회 결과. */
export type TenantSite = {
  tenantId: string
  displayName: string
  logoUrl: string | null
  active: boolean
  /** 그 테넌트의 도메인 전부(host, 포트 포함, 소문자). 테넌트 화면의 리디렉트는 이 밖으로 나가지 않는다. */
  hosts: readonly string[]
}

export type Site =
  /** 이 배포의 기본 주소(AUTH_WEB_ORIGIN) — 지금까지의 화면 그대로. */
  | { kind: "default"; origin: string }
  /** 활성 테넌트의 도메인 — 그 테넌트 브랜드만, 가입·찾기·아몬드영 약관 없음. */
  | {
      kind: "tenant"
      origin: string
      displayName: string
      logoUrl: string | null
      hosts: readonly string[]
    }
  /**
   * 모르는 주소·준비/정지 테넌트·조회 실패 — 로그인 폼 대신 브랜드 없는 중립 오류. 기본 화면으로 떨어지면 테넌트 도메인에
   * 아몬드영 화면(가입·약관)이 뜬다.
   */
  | { kind: "unavailable" }

export async function resolveSite(
  requestHost: string | null,
  defaultOrigin: string,
  lookup: (host: string) => Promise<TenantSite | null>
): Promise<Site> {
  const defaultUrl = new URL(defaultOrigin)
  const host = (requestHost ?? "").trim().toLowerCase()
  if (!host) return { kind: "unavailable" }
  if (host === defaultUrl.host)
    return { kind: "default", origin: defaultOrigin }

  const tenant = await lookup(host).catch(() => null)
  if (!tenant?.active) return { kind: "unavailable" }
  return {
    kind: "tenant",
    // CloudFront 뒤에서는 x-forwarded-proto 가 늘 믿을 만하지 않다 — 테넌트 배포도 기본 주소와 같은 scheme 이다.
    origin: `${defaultUrl.protocol}//${host}`,
    displayName: tenant.displayName,
    logoUrl: tenant.logoUrl,
    hosts: tenant.hosts,
  }
}

/**
 * redirect_to·redirect_uri·로그아웃 뒤 주소가 이 화면에서 나가도 되는 곳인지. 되면 정규화한 URL, 아니면 null.
 * - 기본 화면: 기존 규칙(ALLOWED_REDIRECT_HOSTS 와 정확히 같거나 «.접미사»).
 * - 테넌트 화면: 그 테넌트 도메인과 정확히 같은 host 만 — 접미사 규칙을 쓰면 테넌트가 고를 수 없는 하위 주소가 열린다.
 * - 중립 오류 화면: 어디로도.
 */
export function allowedRedirect(
  raw: string | null | undefined,
  site: Site,
  defaultAllowedHosts: readonly string[]
): string | null {
  if (!raw || site.kind === "unavailable") return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.host

  const match =
    site.kind === "tenant"
      ? site.hosts.includes(host)
      : defaultAllowedHosts.some((allowed) =>
          allowed.startsWith(".")
            ? host === allowed.slice(1) || host.endsWith(allowed)
            : host === allowed
        )
  return match ? url.toString() : null
}

/**
 * 주소 → 테넌트 조회를 서버 인스턴스 메모리에 담는다. 모르는 주소(null)도 담고, 실패(던짐)는 담지 않는다.
 * TTL 이 정지가 이 화면에 닿는 늦음의 상한이다 — 세션 자체는 정지 전환이 user-service 에서 끊는다.
 * 항목 수에도 상한을 둔다 — 함수 URL 로 직접 오면 x-forwarded-host 에 아무 값이나 실을 수 있다. 넘치면 가장 오래 넣은 것부터 버린다.
 */
export function cachedLookup(
  lookup: (host: string) => Promise<TenantSite | null>,
  options: { ttlMs: number; maxEntries?: number; now?: () => number }
): (host: string) => Promise<TenantSite | null> {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? 500
  const entries = new Map<string, { value: TenantSite | null; at: number }>()
  return async (host) => {
    const hit = entries.get(host)
    if (hit && now() - hit.at < options.ttlMs) return hit.value
    const value = await lookup(host)
    entries.delete(host)
    entries.set(host, { value, at: now() })
    if (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    }
    return value
  }
}

/** 기본 주소(AUTH_WEB_ORIGIN)가 섬기는 테넌트 — 아몬드영 로그인은 테넌트 1 이다. */
const DEFAULT_SITE_TENANT_ID = "1"

/**
 * 인가 코드를 이 redirect_uri 로 보내도 되는가(클라이언트 등록 여부는 user-service 가 따로 본다).
 * 같은 admin-web 클라이언트에 모든 테넌트의 주소가 등록돼 있어서, 등록 검사만으로는 화면과 토큰 테넌트가 어긋날 수 있다.
 * - 테넌트 화면: 그 테넌트 도메인만.
 * - 기본 화면: 다른 테넌트(≠ 1)의 도메인이면 거절 — 테넌트 직원이 아몬드영 화면으로 들어와 첫 로그인 변경을 건너뛰지 않게.
 *   테넌트 도메인이 아닌 주소(쇼핑몰·결제창·앱 loopback)는 지금처럼 user-service 판정만. 조회가 실패하면 거절.
 * - 중립 오류 화면: 어디로도.
 */
export async function codeRedirectAllowed(
  redirectUri: string,
  site: Site,
  lookup: (host: string) => Promise<TenantSite | null>
): Promise<boolean> {
  if (site.kind === "unavailable") return false
  if (site.kind === "tenant")
    return allowedRedirect(redirectUri, site, []) !== null
  let host: string
  try {
    host = new URL(redirectUri).host.toLowerCase()
  } catch {
    return false
  }
  try {
    const owner = await lookup(host)
    return !owner || owner.tenantId === DEFAULT_SITE_TENANT_ID
  } catch {
    return false
  }
}
