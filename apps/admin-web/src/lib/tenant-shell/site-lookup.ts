// 미들웨어(Edge)·라우트·서버 컴포넌트가 함께 쓴다 — fetch·process.env 만 쓰고 next·server-only 를 import 하지 않는다.
import { cachedLookup, resolveAdminSite, type AdminSite, type AdminSiteRecord } from './site-rules';

/** 느린 user-service 가 모든 화면을 붙잡지 않게 끊는다. 끊기면 그 주소는 중립 화면이다(기본 주소는 묻지 않는다). */
const LOOKUP_TIMEOUT_MS = 3_000;

/**
 * user-service 조회 `GET /tenant-brand/admin-site?host=` — admin-web 의 OIDC 클라이언트 자격(Basic)으로 연다. 새 자격증명을 늘리지
 * 않으려고 이미 쥔 비밀을 쓴다. admin-web 주소가 아니면 404 = 모르는 주소.
 */
async function lookupAdminSite(host: string): Promise<AdminSiteRecord | null> {
  const base = process.env.USER_SERVICE_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!base || !clientId || !clientSecret) {
    throw new Error('USER_SERVICE_URL·OIDC_CLIENT_ID·OIDC_CLIENT_SECRET are not configured');
  }
  const res = await fetch(`${base.replace(/\/+$/, '')}/tenant-brand/admin-site?host=${encodeURIComponent(host)}`, {
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  // 400 = host 꼴이 아니다(Host 헤더에 아무 값이나 올 수 있다) — 모르는 주소와 같다.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`tenant-brand/admin-site responded ${res.status}`);
  return parseAdminSiteRecord(await res.json());
}

/** 응답 봉투의 data — 꼴이 다르면 던진다(그 주소는 중립 화면). */
function parseAdminSiteRecord(body: unknown): AdminSiteRecord {
  const data = typeof body === 'object' && body !== null && 'data' in body ? body.data : null;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('tenantId' in data && typeof data.tenantId === 'string') ||
    !('displayName' in data && typeof data.displayName === 'string') ||
    !('active' in data && typeof data.active === 'boolean')
  ) {
    throw new Error('tenant-brand/admin-site returned an unexpected body');
  }
  const logoUrl = 'logoUrl' in data && typeof data.logoUrl === 'string' ? data.logoUrl : null;
  const authHost = 'authHost' in data && typeof data.authHost === 'string' ? data.authHost : null;
  return { tenantId: data.tenantId, displayName: data.displayName, logoUrl, active: data.active, authHost };
}

const lookup = cachedLookup(lookupAdminSite, { ttlMs: 60_000 });

/** 기본 주소 = OIDC 콜백 주소의 기원. 이 주소는 조회 없이 기존 셸이다. */
export function defaultAdminOrigin(): string {
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!redirectUri) throw new Error('OIDC_REDIRECT_URI is not configured');
  return new URL(redirectUri).origin;
}

/**
 * 이 주소의 셸. `BYPASS_AUTH=true`(MSW 로 화면만 보는 개발 모드)는 user-service 없이 뜨므로 언제나 기존 셸이다.
 */
export function resolveSiteForHost(host: string | null): Promise<AdminSite> {
  if (process.env.BYPASS_AUTH === 'true') return Promise.resolve({ kind: 'default' });
  return resolveAdminSite(host, defaultAdminOrigin(), lookup);
}
