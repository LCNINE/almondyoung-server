import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getTokenPayload, verifyAccessToken } from './get-token-payload';
import { MyPermissionsCache, parseMyPermissions, type MyPermissions } from './my-permissions';

export type PermissionState =
  | { readonly state: 'unauthenticated' }
  | { readonly state: 'unavailable' }
  | {
      readonly state: 'ready';
      readonly roles: MyPermissions['roles'];
      readonly permissions: ReadonlySet<string>;
      readonly version: string;
      readonly landingPath: string | null;
      /** 이 사본을 user-service 에서 받은 시각 — 브라우저 캐시에 넘길 때 신선도 기준 */
      readonly fetchedAt: number;
    };

/** 느린 응답이 화면 렌더를 붙잡지 않게 끊는다. 끊기면 마지막 사본을 쓴다. */
const FETCH_TIMEOUT_MS = 3_000;

async function fetchMyPermissions(accessToken?: string): Promise<MyPermissions> {
  const base = process.env.USER_SERVICE_URL;
  if (!base) throw new Error('USER_SERVICE_URL is not configured');
  const token = accessToken ?? (await cookies()).get('accessToken')?.value ?? '';
  const response = await fetch(`${base.replace(/\/+$/, '')}/me/permissions`, {
    headers: {
      Cookie: `accessToken=${token}`,
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
  const copy = await processCache.getWithTime(payload.roles);
  if (!copy) return { state: 'unavailable' };
  const { value, fetchedAt } = copy;
  return {
    state: 'ready',
    roles: value.roles,
    permissions: value.permissions,
    version: value.version,
    landingPath: value.landingPath,
    fetchedAt,
  };
});

/**
 * 막 발급된 토큰(아직 쿠키에 없다)으로 권한을 받는다 — 로그인 콜백 전용. 같은 역할 조합 캐시를 쓴다.
 * 서명을 검증하지 못하거나 조회가 실패하면 null(첫 화면 없이 기본 목적지로).
 */
export async function getMyPermissionsForToken(accessToken: string): Promise<MyPermissions | null> {
  const payload = await verifyAccessToken(accessToken);
  if (!payload) return null;
  return processCache.get(payload.roles, () => fetchMyPermissions(accessToken));
}
