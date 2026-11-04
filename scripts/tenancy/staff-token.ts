import { createHash, randomBytes } from 'node:crypto';
import { probe } from './isolation-check/http';
import type { Probe } from './isolation-check/judge';

/**
 * 직원 앱 클라이언트(admin-web)의 액세스 토큰을 auth-web 이 로그인 뒤 하는 길 그대로 받는다:
 * 내부 secret 으로 코드 발급 → 클라이언트 secret 으로 PKCE 교환. 토큰 테넌트는 `redirectUri` 의 host(테넌트 도메인)로
 * user-service 가 정한다 — 요청 파라미터로 고르지 않는다.
 */
export interface StaffClient {
  readonly baseUrl: string;
  readonly internalSecret: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** 발급·교환이 거절됐다(정지·준비 테넌트, 틀린 비밀번호 등). 실측은 이 거절 자체를 판정한다. */
export class TokenRefused extends Error {
  constructor(
    readonly stage: 'signin' | 'issue-code' | 'token',
    readonly status: number,
    body: string,
  ) {
    super(`${stage} 거절 ${status} ${body.slice(0, 200)}`);
  }
}

export async function tokenForUser(client: StaffClient, userId: string): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const issued = await fetch(`${client.baseUrl}/oauth/internal/issue-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': client.internalSecret },
    body: JSON.stringify({
      clientId: client.clientId,
      userId,
      redirectUri: client.redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scope: 'openid profile email',
    }),
  });
  if (!issued.ok) throw new TokenRefused('issue-code', issued.status, await issued.text());
  const { code } = (await issued.json()) as { code: string };

  const token = await fetch(`${client.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: client.redirectUri,
      code_verifier: verifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  if (!token.ok) throw new TokenRefused('token', token.status, await token.text());
  const { access_token } = (await token.json()) as { access_token: string };
  return access_token;
}

/**
 * 로그인 화면의 테넌트를 실은 로그인 — auth-web 이 그 테넌트 화면에서 하는 호출 그대로(보증 헤더 `x-tenant-id` +
 * `x-internal-secret`). 판정하려고 응답을 상태·본문 그대로 돌려준다(던지지 않는다).
 */
export function signInAtSite(
  client: Pick<StaffClient, 'baseUrl' | 'internalSecret'>,
  loginId: string,
  password: string,
  siteTenantId: string,
): Promise<Probe> {
  return probe('POST', `${client.baseUrl}/auth/signin`, {
    json: { loginId, password },
    headers: { 'x-tenant-id': siteTenantId, 'x-internal-secret': client.internalSecret },
  });
}

/**
 * 비밀번호로 로그인한 뒤(auth-web 의 signin 과 같은 호출) 그 계정의 직원 토큰을 받는다. 계정은 한 테넌트의 것이고 아이디는 테넌트 안에서만
 * unique 라(ADR-0056) 로그인은 `accountTenantId` 화면에서 한다 — auth-web 처럼 보증 헤더로 싣는다. 토큰의 테넌트는 그와 따로 `redirectUri` 가 정한다
 * (다른 테넌트 주소면 코드 발급이 거절된다).
 */
export async function signInStaff(
  client: StaffClient,
  loginId: string,
  password: string,
  accountTenantId: string,
): Promise<string> {
  const signin = await fetch(`${client.baseUrl}/auth/signin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': accountTenantId,
      'x-internal-secret': client.internalSecret,
    },
    body: JSON.stringify({ loginId, password }),
  });
  if (!signin.ok) throw new TokenRefused('signin', signin.status, await signin.text());
  const session = ((await signin.json()) as { data: { accessToken: string } }).data.accessToken;
  const me = await fetch(`${client.baseUrl}/users/me`, { headers: { authorization: `Bearer ${session}` } });
  if (!me.ok) throw new TokenRefused('signin', me.status, await me.text());
  const { id } = ((await me.json()) as { data: { id: string } }).data;
  return tokenForUser(client, id);
}
