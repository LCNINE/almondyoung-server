import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getTokenPayload } from './get-token-payload';
import { MyPermissionsCache, parseMyPermissions, type MyPermissions } from './my-permissions';

export type PermissionState =
  | { readonly state: 'unauthenticated' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'ready'; readonly roles: MyPermissions['roles']; readonly permissions: ReadonlySet<string> };

/** 느린 응답이 화면 렌더를 붙잡지 않게 끊는다. 끊기면 마지막 사본을 쓴다. */
const FETCH_TIMEOUT_MS = 3_000;

async function fetchMyPermissions(): Promise<MyPermissions> {
  const base = process.env.USER_SERVICE_URL;
  if (!base) throw new Error('USER_SERVICE_URL is not configured');
  const store = await cookies();
  const response = await fetch(`${base.replace(/\/+$/, '')}/me/permissions`, {
    headers: {
      Cookie: `accessToken=${store.get('accessToken')?.value ?? ''}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`me/permissions responded ${response.status}`);
  return parseMyPermissions(await response.json());
}

// 프로세스(서버 인스턴스)마다 하나. 역할 조합이 키라 사용자 수와 무관하게 몇 개뿐이다.
const processCache = new MyPermissionsCache(() => fetchMyPermissions());

/**
 * 서버 컴포넌트·라우트 핸들러의 권한 출처. 한 렌더 안에서는 `cache()` 로 한 번만 계산한다.
 * 토큰은 서명을 검증한 뒤의 역할만 키로 쓴다.
 */
export const getMyPermissions = cache(async (): Promise<PermissionState> => {
  const payload = await getTokenPayload();
  if (!payload) return { state: 'unauthenticated' };
  const value = await processCache.get(payload.roles);
  if (!value) return { state: 'unavailable' };
  return { state: 'ready', roles: value.roles, permissions: value.permissions };
});
