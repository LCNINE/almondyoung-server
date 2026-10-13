import type { MyPermissions } from './my-permissions';
import { permissionLabel } from './permission-labels';
import { canAny } from './screen-access';

export type CanState = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly allowed: boolean };

export function checkCan(query: { isPending: boolean; isError: boolean; data?: MyPermissions }, anyOf: readonly string[]): CanState {
  if (query.data) return { status: 'ready', allowed: canAny(query.data.permissions, anyOf) };
  if (query.isError) return { status: 'error' };
  return { status: 'loading' };
}

export function permissionDeniedMessage(required: readonly string[], serverMessage: string): string {
  if (required.length === 0) return serverMessage;
  return `이 작업에는 ${required.map(permissionLabel).join(' 또는 ')} 권한이 필요합니다.`;
}

/** 403 이 한꺼번에 여러 건 와도 권한은 이 간격에 한 번만 다시 읽는다. */
const PERMISSION_REFRESH_GAP_MS = 10_000;

/**
 * 403 뒤에 내 권한을 다시 읽을지. 권한 조회 자신이 403 이면 다시 읽지 않는다 — 재조회가 또 403 을 내고
 * 다시 재조회를 부르는 고리가 된다.
 */
export function shouldRefreshPermissionsAfter403(url: string | undefined, lastRefreshAt: number, now: number): boolean {
  if (url && /\/me\/permissions(?:[?#]|$)/.test(url)) return false;
  return now - lastRefreshAt >= PERMISSION_REFRESH_GAP_MS;
}

/**
 * 한 화면에서 여러 버튼을 판정할 때 쓰는 상태. 권한을 확인하지 못한 동안(로딩·조회 실패)은
 * `isPermissionLoading` 이 true 다 — 화면이 그 상태를 «권한 없음» 안내로 바꾸지 않게 한다.
 */
export function permissionCheckFrom(query: { isPending: boolean; isError: boolean; data?: MyPermissions }): {
  can: (anyOf: readonly string[]) => boolean;
  isPermissionLoading: boolean;
} {
  const held = query.data?.permissions;
  return {
    can: (anyOf) => (held ? canAny(held, anyOf) : false),
    isPermissionLoading: !held,
  };
}
