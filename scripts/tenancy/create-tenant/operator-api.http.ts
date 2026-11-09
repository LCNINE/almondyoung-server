import { tokenForUser } from '../staff-token';
import type { OperatorApi, TenantDomain, TenantDomainApp, TenantMasterApi, TenantStatus } from './steps';

/**
 * user-service 운영자 API(`/admin/platform/*` + 역할 정의)의 HTTP 어댑터. 운영자가 다른 테넌트의 계정에 닿는 것은 첫 master
 * 만들기·master 비번 비상 초기화 둘뿐이다(ADR-0056). 모든 쓰기는 iam Manager 를 거친다 — 이 파일은 그 API 를 부르기만 한다.
 *
 * 토큰은 부를 때마다 받는다 — 라이브 액세스 토큰은 15분이고, 한 실행이 그보다 길 수 있다(인증서 발급 대기).
 */
export class HttpOperatorApi implements OperatorApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: () => Promise<string>,
  ) {}

  async getTenant(id: string) {
    const t = await this.call<{
      slug: string;
      status: TenantStatus;
      domains: { host: string; app: TenantDomainApp }[];
    }>('GET', `/admin/platform/tenants/${encodeURIComponent(id)}`, undefined, { allow404: true });
    return t ?? null;
  }

  async createTenant(input: { id: string; slug: string; displayName: string; domains: TenantDomain[] }) {
    await this.call('POST', '/admin/platform/tenants', input);
  }

  async deleteTenant(id: string) {
    await this.call('DELETE', `/admin/platform/tenants/${encodeURIComponent(id)}`);
  }

  async addDomain(tenantId: string, domain: TenantDomain) {
    await this.call('POST', `/admin/platform/tenants/${encodeURIComponent(tenantId)}/domains`, domain);
  }

  async setTenantStatus(id: string, status: 'active' | 'suspended') {
    await this.call('PUT', `/admin/platform/tenants/${encodeURIComponent(id)}/status`, { status });
  }

  async staffClientUris(clientId: string) {
    const c = await this.call<{ redirectUris: string[]; postLogoutRedirectUris: string[] }>(
      'GET',
      `/admin/oauth-clients/${encodeURIComponent(clientId)}`,
    );
    return { redirectUris: c?.redirectUris ?? [], postLogoutRedirectUris: c?.postLogoutRedirectUris ?? [] };
  }

  async addStaffClientUris(
    tenantId: string,
    clientId: string,
    uris: { redirectUris: string[]; postLogoutRedirectUris: string[] },
  ) {
    await this.call(
      'POST',
      `/admin/platform/tenants/${encodeURIComponent(tenantId)}/oauth-clients/${encodeURIComponent(clientId)}/uris`,
      uris,
    );
  }

  async findRole(name: string) {
    const roles = (await this.call<{ roleId: string; name: string }[]>('GET', '/admin/roles')) ?? [];
    const summary = roles.find((r) => r.name === name);
    if (!summary) return null;
    const detail = await this.call<{
      roleId: string;
      version: number;
      landingPath: string | null;
      permissions: string[];
    }>('GET', `/admin/roles/${summary.roleId}`);
    if (!detail) return null;
    return {
      roleId: detail.roleId,
      version: detail.version,
      landingPath: detail.landingPath,
      permissions: detail.permissions,
    };
  }

  async createRole(input: {
    name: string;
    displayName: string;
    description: string;
    landingPath?: string;
    permissions: string[];
  }) {
    await this.call('POST', '/admin/roles', input);
  }

  async replaceRolePermissions(roleId: string, permissions: string[], version: number) {
    await this.call('PUT', `/admin/roles/${roleId}/permissions`, { permissions, version });
  }

  async setRoleLandingPath(roleId: string, landingPath: string) {
    await this.call('PATCH', `/admin/roles/${roleId}`, { landingPath });
  }

  async tenantMasters(tenantId: string) {
    return (
      (await this.call<{ userId: string; loginId: string }[]>(
        'GET',
        `/admin/platform/tenants/${encodeURIComponent(tenantId)}/masters`,
      )) ?? []
    );
  }

  async createFirstMaster(
    tenantId: string,
    input: { loginId: string; username: string; nickname: string; email: string; forcePasswordChange: boolean },
  ) {
    const made = await this.call<{ userId: string; initialPassword: string }>(
      'POST',
      `/admin/platform/tenants/${encodeURIComponent(tenantId)}/first-master`,
      input,
    );
    if (!made) throw new Error('첫 master 만들기 응답이 비었다');
    return made;
  }

  async resetMasterPassword(tenantId: string, userId: string, forcePasswordChange: boolean) {
    const r = await this.call<{ initialPassword: string }>(
      'POST',
      `/admin/platform/tenants/${encodeURIComponent(tenantId)}/masters/${userId}/password`,
      { forcePasswordChange },
    );
    if (!r) throw new Error('비밀번호 비상 초기화 응답이 비었다');
    return r.initialPassword;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { allow404?: boolean } = {},
  ): Promise<T | undefined> {
    const r = await callUserService<T>(this.baseUrl, this.accessToken, method, path, body, opts);
    if (r === CONFLICT) throw new Error(`${method} ${path} → 409`);
    return r;
  }
}

/**
 * 그 테넌트 안의 일 — 점검 master(그 테넌트의 첫 master)의 토큰으로 직원 계정을 만든다. 테넌트는 토큰 테넌트뿐이라 요청에
 * 테넌트를 싣지 않는다(ADR-0056).
 */
export class HttpTenantMasterApi implements TenantMasterApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: () => Promise<string>,
  ) {}

  async roleMemberLoginIds(roleId: string) {
    const members = await callUserService<{ loginId: string }[]>(
      this.baseUrl,
      this.accessToken,
      'GET',
      `/admin/roles/${roleId}/members`,
    );
    if (members === CONFLICT) throw new Error('역할 구성원 조회 → 409');
    return (members ?? []).map((m) => m.loginId);
  }

  async createStaff(input: { loginId: string; username: string; nickname: string; email: string; roleId: string }) {
    const made = await callUserService<{ user: { id: string }; initialPassword: string }>(
      this.baseUrl,
      this.accessToken,
      'POST',
      '/admin/auth',
      input,
      { allow409: true },
    );
    if (made === CONFLICT) return null;
    if (!made) throw new Error('계정 만들기 응답이 비었다');
    return { userId: made.user.id, initialPassword: made.initialPassword };
  }
}

/** `allow409` 호출이 409 를 받았다 */
const CONFLICT = Symbol('409');

/** user-service 응답 봉투(`{ success, data }`)를 벗긴다. 404 를 «없음»으로 받는 호출만 `allow404`, 409 를 «이미 있음»으로 받는 호출만 `allow409`. */
async function callUserService<T>(
  baseUrl: string,
  accessToken: () => Promise<string>,
  method: string,
  path: string,
  body?: unknown,
  opts: { allow404?: boolean; allow409?: boolean } = {},
): Promise<T | typeof CONFLICT | undefined> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (opts.allow404 && res.status === 404) return undefined;
  if (opts.allow409 && res.status === 409) return CONFLICT;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${errorMessage(text)}`);
  if (!text) return undefined;
  const json = JSON.parse(text) as { data?: T };
  return json.data;
}

/** 오류 봉투의 `message` 만 — 로컬 user-service 는 stack 까지 싣는다. */
function errorMessage(text: string): string {
  try {
    const message = (JSON.parse(text) as { message?: unknown }).message;
    if (message !== undefined) return Array.isArray(message) ? message.join(', ') : String(message);
  } catch {
    // 본문이 JSON 이 아니면 앞부분만
  }
  return text.slice(0, 300);
}

/**
 * 로컬 운영자(시드의 admin 계정, 운영자 성질 + 테넌트 1 master)의 액세스 토큰을 받는다.
 * auth-web 이 로그인 뒤 하는 일과 같은 길이다: 내부 secret 으로 코드 발급 → admin-web 클라이언트로 PKCE 교환.
 * 토큰 테넌트는 admin-web 의 등록 리디렉트 host(테넌트 1 도메인)로 정해진다.
 */
export async function localOperatorToken(opts: {
  baseUrl: string;
  internalSecret: string;
  operatorUserId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  return tokenForUser(opts, opts.operatorUserId);
}
