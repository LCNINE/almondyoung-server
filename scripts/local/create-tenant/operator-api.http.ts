import { createHash, randomBytes } from 'node:crypto';
import type { OperatorApi, TenantStatus } from '../../tenancy/create-tenant/steps';

/**
 * user-service 운영자 API(`/admin/platform/*` + 테넌트를 받는 역할·계정·부여 API)의 HTTP 어댑터.
 * 모든 쓰기는 iam Manager 를 거친다 — 이 파일은 그 API 를 부르기만 한다.
 */
export class HttpOperatorApi implements OperatorApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async getTenant(id: string) {
    const t = await this.call<{ slug: string; status: TenantStatus; domains: string[] }>(
      'GET',
      `/admin/platform/tenants/${encodeURIComponent(id)}`,
      undefined,
      { allow404: true },
    );
    return t ?? null;
  }

  async createTenant(input: { id: string; slug: string; displayName: string; domains: string[] }) {
    await this.call('POST', '/admin/platform/tenants', input);
  }

  async deleteTenant(id: string) {
    await this.call('DELETE', `/admin/platform/tenants/${encodeURIComponent(id)}`);
  }

  async addDomain(tenantId: string, host: string) {
    await this.call('POST', `/admin/platform/tenants/${encodeURIComponent(tenantId)}/domains`, { host });
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
    const detail = await this.call<{ roleId: string; version: number; landingPath: string | null; permissions: string[] }>(
      'GET',
      `/admin/roles/${summary.roleId}`,
    );
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
    landingPath: string;
    permissions: string[];
    tenantId: string;
  }) {
    await this.call('POST', '/admin/roles', input);
  }

  async replaceRolePermissions(roleId: string, permissions: string[], version: number) {
    await this.call('PUT', `/admin/roles/${roleId}/permissions`, { permissions, version });
  }

  async setRoleLandingPath(roleId: string, landingPath: string) {
    await this.call('PATCH', `/admin/roles/${roleId}`, { landingPath });
  }

  async roleMemberLoginIds(roleId: string) {
    const members = (await this.call<{ loginId: string }[]>('GET', `/admin/roles/${roleId}/members`)) ?? [];
    return members.map((m) => m.loginId);
  }

  async findUserIdByLoginId(loginId: string) {
    const page = await this.call<{ data: { id: string; loginId: string }[] }>(
      'GET',
      `/admin/users?q=${encodeURIComponent(loginId)}&limit=100`,
    );
    return page?.data.find((u) => u.loginId === loginId)?.id ?? null;
  }

  async createStaff(input: {
    loginId: string;
    username: string;
    nickname: string;
    email: string;
    roleId: string;
    tenantId: string;
    forcePasswordChange: boolean;
  }) {
    const made = await this.call<{ user: { id: string }; initialPassword: string }>('POST', '/admin/auth', input);
    if (!made) throw new Error('계정 만들기 응답이 비었다');
    return { userId: made.user.id, initialPassword: made.initialPassword };
  }

  async addMember(tenantId: string, userId: string) {
    await this.call('POST', `/admin/platform/tenants/${encodeURIComponent(tenantId)}/members`, { userId });
  }

  async addRoleMembers(roleId: string, tenantId: string, userIds: string[]) {
    await this.call('POST', `/admin/roles/${roleId}/members`, { userIds, expiresAt: null, tenantId });
  }

  async reissuePassword(tenantId: string, userId: string, forcePasswordChange: boolean) {
    const r = await this.call<{ initialPassword: string }>(
      'POST',
      `/admin/platform/tenants/${encodeURIComponent(tenantId)}/users/${userId}/password`,
      { forcePasswordChange },
    );
    if (!r) throw new Error('비밀번호 재발급 응답이 비었다');
    return r.initialPassword;
  }

  /** user-service 응답 봉투(`{ success, data }`)를 벗긴다. 404 를 «없음»으로 받는 호출만 `allow404`. */
  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { allow404?: boolean } = {},
  ): Promise<T | undefined> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (opts.allow404 && res.status === 404) return undefined;
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${errorMessage(text)}`);
    if (!text) return undefined;
    const json = JSON.parse(text) as { data?: T };
    return json.data;
  }
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
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const issued = await fetch(`${opts.baseUrl}/oauth/internal/issue-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': opts.internalSecret },
    body: JSON.stringify({
      clientId: opts.clientId,
      userId: opts.operatorUserId,
      redirectUri: opts.redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scope: 'openid profile email',
    }),
  });
  if (!issued.ok) throw new Error(`운영자 코드 발급 실패 ${issued.status} ${(await issued.text()).slice(0, 200)}`);
  const { code } = (await issued.json()) as { code: string };

  const token = await fetch(`${opts.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: opts.redirectUri,
      code_verifier: verifier,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
  });
  if (!token.ok) throw new Error(`운영자 토큰 교환 실패 ${token.status} ${(await token.text()).slice(0, 200)}`);
  const { access_token } = (await token.json()) as { access_token: string };
  return access_token;
}
