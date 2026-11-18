import { join } from 'node:path';
import { readEnvFile, REPO } from '../../local/create-tenant/local-ports';
import { tokenTenantOf } from '../../tenancy/isolation-check/judge';
import { stageServiceUrl } from '../../tenancy/isolation-check/live-config';
import { ask, operatorSession } from '../../tenancy/operator-session';
import { signInStaff, type StaffClient } from '../../tenancy/staff-token';

export interface EmergencySession {
  coreUrl: string;
  usersUrl: string;
  token: () => Promise<string>;
}

const TOKEN_REUSE_MS = 10 * 60_000;

// 로컬 포트·테넌트 1 값은 scripts/local/e2e-env-map.sh 의 표와 같다 (user-service 3000, core 3100,
// E2E_SERVED_TENANT_ID '1'). redirectUri 는 scripts/local/isolation-check/index.ts 의 테넌트 1 값과 같다.
const LOCAL = {
  usersUrl: 'http://localhost:3000',
  coreUrl: 'http://localhost:3100',
  tenantOneId: '1',
  redirectUri: 'http://localhost:8002/auth/callback',
};

async function localSession(): Promise<EmergencySession> {
  const userEnv = readEnvFile(join(REPO, 'apps/user-service/.env'));
  const adminWebEnv = readEnvFile(join(REPO, 'apps/admin-web/.env.local'));
  const client: StaffClient = {
    baseUrl: LOCAL.usersUrl,
    internalSecret: userEnv.OAUTH_INTERNAL_SECRET ?? '',
    clientId: adminWebEnv.OIDC_CLIENT_ID ?? 'admin-web',
    clientSecret: adminWebEnv.OIDC_CLIENT_SECRET ?? '',
    redirectUri: LOCAL.redirectUri,
  };
  const loginId = await ask('운영자 아이디: ', false);
  const password = await ask('운영자 비밀번호(안 보인다): ', true);
  let cached: { token: string; at: number } | null = null;
  const token = async () => {
    if (cached && Date.now() - cached.at < TOKEN_REUSE_MS) return cached.token;
    const t = await signInStaff(client, loginId, password, LOCAL.tenantOneId);
    if (tokenTenantOf(t) !== LOCAL.tenantOneId) {
      throw new Error(`토큰의 테넌트가 ${tokenTenantOf(t) ?? '없음'} 이다 — 테넌트 ${LOCAL.tenantOneId} 여야 한다`);
    }
    cached = { token: t, at: Date.now() };
    return t;
  };
  await token(); // 틀린 비밀번호는 시작 전에
  return { coreUrl: LOCAL.coreUrl, usersUrl: LOCAL.usersUrl, token };
}

export async function openSession(stage: 'local' | 'live'): Promise<EmergencySession> {
  if (stage === 'local') return localSession();
  const { users, token } = await operatorSession('live');
  return { coreUrl: stageServiceUrl('live', 'core'), usersUrl: users, token };
}

/** GET {usersUrl}/me/permissions — user-service 응답은 `{ data }` 로 감싸일 수 있다. */
export async function myPermissions(session: EmergencySession): Promise<string[]> {
  const res = await fetch(`${session.usersUrl}/me/permissions`, {
    headers: { authorization: `Bearer ${await session.token()}` },
  });
  if (!res.ok) throw new Error(`내 권한 조회 실패 ${res.status}`);
  const body: unknown = await res.json();
  const list =
    (isRecord(body) && isRecord(body.data) ? body.data.permissions : undefined) ??
    (isRecord(body) ? body.permissions : undefined);
  if (!Array.isArray(list) || !list.every((p): p is string => typeof p === 'string')) {
    throw new Error('내 권한 조회 응답에 permissions 목록이 없다 — user-service 응답 모양이 바뀌었는지 확인한다');
  }
  return list;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
