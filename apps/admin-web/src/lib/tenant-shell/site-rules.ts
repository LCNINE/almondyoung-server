// 순수 규칙 — next·server-only 를 import 하지 않는다(미들웨어(Edge)·라우트·서버 컴포넌트가 함께 쓴다).

/** user-service 가 admin-web 서버에만(그 OIDC 클라이언트 자격으로) 주는 «admin-web 주소 → 테넌트» 조회 결과. */
export type AdminSiteRecord = {
  tenantId: string;
  displayName: string;
  logoUrl: string | null;
  active: boolean;
  /** 그 테넌트의 auth-web 주소(host) — 테넌트 셸의 로그인은 여기로 간다. */
  authHost: string | null;
};

export type AdminSite =
  /** 기존 셸 — 기본 주소(OIDC_REDIRECT_URI 의 host)와 테넌트 1 의 다른 admin-web 주소. 로그인 주소는 env 그대로. */
  | { kind: 'default' }
  /** 테넌트 셸 — 활성 테넌트의 admin-web 주소. 그 테넌트 브랜드만, 허용 목록 화면만. */
  | {
      kind: 'tenant';
      origin: string;
      authOrigin: string;
      tenantId: string;
      displayName: string;
      logoUrl: string | null;
    }
  /**
   * 모르는 주소·준비/정지 테넌트·auth-web 주소 없는 테넌트·조회 실패 — 브랜드 없는 중립 화면. 기존 셸로 떨어지면 테넌트 도메인에
   * 아몬드영 셸이 뜬다.
   */
  | { kind: 'unavailable' };

/** 기존 셸이 섬기는 테넌트 — 아몬드영 관리자는 테넌트 1 이다(auth-web `site-rules.ts` 와 같은 값). */
export const DEFAULT_SITE_TENANT_ID = '1';

export async function resolveAdminSite(
  requestHost: string | null,
  defaultOrigin: string,
  lookup: (host: string) => Promise<AdminSiteRecord | null>
): Promise<AdminSite> {
  const defaultUrl = new URL(defaultOrigin);
  const host = (requestHost ?? '').trim().toLowerCase();
  if (!host) return { kind: 'unavailable' };
  if (host === defaultUrl.host) return { kind: 'default' };

  const record = await lookup(host).catch(() => null);
  if (!record?.active) return { kind: 'unavailable' };
  if (record.tenantId === DEFAULT_SITE_TENANT_ID) return { kind: 'default' };
  if (!record.authHost) return { kind: 'unavailable' };
  // CloudFront 뒤에서는 x-forwarded-proto 가 늘 믿을 만하지 않다 — 테넌트 배포도 기본 주소와 같은 scheme 이다.
  return {
    kind: 'tenant',
    origin: `${defaultUrl.protocol}//${host}`,
    authOrigin: `${defaultUrl.protocol}//${record.authHost}`,
    tenantId: record.tenantId,
    displayName: record.displayName,
    logoUrl: record.logoUrl,
  };
}

/**
 * 이 셸이 그 토큰을 받는가 — 양방향이다. 테넌트 셸은 그 테넌트 토큰만, 기존 셸은 테넌트 1 토큰만. 테넌트 없는 토큰(`tenant` 클레임
 * 전에 나간 것)은 기존 셸이 warn 모드에서만 받는다(서버 자격증명 라우트의 판정과 같다). 셸은 방어선이 아니다 — 서버 쪽 문이 따로 막는다.
 */
export function admitsToken(site: AdminSite, tokenTenant: string | undefined, gateMode: string | undefined): boolean {
  if (site.kind === 'unavailable') return false;
  if (site.kind === 'tenant') return tokenTenant === site.tenantId;
  if (tokenTenant === undefined) return gateMode === 'warn';
  return tokenTenant === DEFAULT_SITE_TENANT_ID;
}

export type OidcEndpoints = {
  authorizationUrl: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
};

/**
 * 이 주소의 로그인·로그아웃 주소. 기존 셸은 env 그대로, 테넌트 셸은 그 테넌트의 auth-web 과 들어온 테넌트 주소 — 기본 auth 화면은
 * 다른 테넌트 redirect_uri 를 거절하고, 콜백이 다른 주소로 가면 host-only 쿠키가 그 주소에 붙는다. 중립 화면은 어디로도 보내지 않는다.
 */
export function oidcEndpointsFor(site: AdminSite, env: OidcEndpoints): OidcEndpoints | null {
  if (site.kind === 'unavailable') return null;
  if (site.kind === 'default') return env;
  return {
    authorizationUrl: `${site.authOrigin}/oauth/authorize`,
    redirectUri: `${site.origin}/auth/callback`,
    postLogoutRedirectUri: `${site.origin}/login`,
  };
}

/**
 * redirect 를 만들 기원. 테넌트 셸은 언제나 들어온 테넌트 주소 — `request.nextUrl.origin` 은 라우트 핸들러에서 Host 를 따르지 않아
 * (next dev 실측: 서버가 뜬 주소) 로그인 뒤 테넌트 도메인을 잃는다. 기존 셸은 지금처럼.
 */
export function redirectOriginOf(site: AdminSite, request: { nextUrl: { origin: string } }): string {
  return site.kind === 'tenant' ? site.origin : request.nextUrl.origin;
}

/** 들어온 주소 — 테넌트 도메인 배포는 CloudFront 요청 함수가 `x-forwarded-host` 에 원래 Host 를 싣는다. */
export function requestHostFrom(header: (name: string) => string | null): string | null {
  const forwarded = header('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || header('host') || null;
}

/**
 * 주소 → 테넌트 조회를 인스턴스 메모리에 담는다. 모르는 주소(null)도 담고, 실패(던짐)는 담지 않는다. TTL 이 정지가 셸에 닿는 늦음의
 * 상한이다(세션은 정지 전환이 user-service 에서 끊는다). 함수 URL 로 직접 오면 x-forwarded-host 에 아무 값이나 실을 수 있어 항목 수에도
 * 상한을 둔다 — 넘치면 가장 오래 넣은 것부터 버린다.
 */
export function cachedLookup(
  lookup: (host: string) => Promise<AdminSiteRecord | null>,
  options: { ttlMs: number; maxEntries?: number; now?: () => number }
): (host: string) => Promise<AdminSiteRecord | null> {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 500;
  const entries = new Map<string, { value: AdminSiteRecord | null; at: number }>();
  return async (host) => {
    const hit = entries.get(host);
    if (hit && now() - hit.at < options.ttlMs) return hit.value;
    const value = await lookup(host);
    entries.delete(host);
    entries.set(host, { value, at: now() });
    if (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    return value;
  };
}
