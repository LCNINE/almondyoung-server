import { combinedRequirement, requirementMessage, requirementMet, type PermissionedAction } from './mutation-permission';
import type { MyPermissions } from './my-permissions';
import { canAccess, canAny, resolveScreenAccess } from './screen-access';

export { permissionDeniedMessage } from './permission-labels';

export type CanState = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly allowed: boolean };

export function checkCan(query: { isPending: boolean; isError: boolean; data?: MyPermissions }, anyOf: readonly string[]): CanState {
  if (query.data) return { status: 'ready', allowed: canAny(query.data.permissions, anyOf) };
  if (query.isError) return { status: 'error' };
  return { status: 'loading' };
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
  canRun: (...actions: PermissionedAction[]) => boolean;
  blockedReason: (...actions: PermissionedAction[]) => string | null;
} {
  const held = query.data?.permissions;
  return {
    // 재조회가 실패한 동안은 이전 사본으로 열지 않는다(확인 못 함 — 셸 배너가 알린다)
    can: (anyOf) => (held && !query.isError ? canAny(held, anyOf) : false),
    // 재조회가 실패한 동안도 «확인 못 함»이다(이전 사본이 있어도) — 화면이 «권한 없음»으로 말하지 않게
    isPermissionLoading: !held || query.isError,
    canRun: (...actions) => showTrigger(runState(query, actions)),
    blockedReason: (...actions) => blockedReason(runState(query, actions), actions),
  };
}

/** 동작(뮤테이션 훅) 여럿을 함께 판정한다(전부 필요). */
export function runState(query: { isPending: boolean; isError: boolean; data?: MyPermissions }, actions: readonly PermissionedAction[]): CanState {
  // 재조회가 실패하면 이전 사본이 남아 있어도 «확인 못 함»이다 — 쓰기는 확인된 권한으로만 연다(셸 배너가 알린다)
  if (query.isError) return { status: 'error' };
  if (query.data) return { status: 'ready', allowed: requirementMet(query.data.permissions, combinedRequirement(actions)) };
  return { status: 'loading' };
}

/**
 * 쓰기 트리거를 그릴지. 권한이 «확인돼서» 있을 때만 그린다 — 확인 중·조회 실패엔 숨기고,
 * 실패는 화면 위 배너가 알린다(`PermissionStatusBanner`). 판정은 그래도 API 가 한다.
 */
export function showTrigger(state: CanState): boolean {
  return state.status === 'ready' && state.allowed;
}

export const PERMISSION_CHECKING_MESSAGE = '권한을 확인하는 중입니다.';
export const PERMISSION_LOOKUP_FAILED_MESSAGE = '권한 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

/**
 * 값을 보여 주는 컨트롤·편집 폼을 막을 이유. 허용이 확인됐을 때만 null.
 * 확인 중·조회 실패는 «권한 없음»이 아니라 그 상태를 그대로 말한다.
 */
export function blockedReason(state: CanState, actions: readonly PermissionedAction[]): string | null {
  if (state.status === 'loading') return PERMISSION_CHECKING_MESSAGE;
  if (state.status === 'error') return PERMISSION_LOOKUP_FAILED_MESSAGE;
  return state.allowed ? null : requirementMessage(combinedRequirement(actions));
}

/**
 * 다른 화면으로 가는 링크·버튼(뮤테이션 없이 이동만 하는 쓰기 진입점). 그 화면의 진입 권한표로 판정한다 —
 * 화면이 들여보내 주지 않을 사람에게 링크를 보이지 않는다. 표에 없는 경로는 코드 실수라 던진다.
 */
export function openState(query: { isPending: boolean; isError: boolean; data?: MyPermissions }, screen: string): CanState {
  const access = resolveScreenAccess(screen);
  if (!access) throw new Error(`화면 권한표에 없는 경로: ${screen}`);
  if (query.isError) return { status: 'error' };
  if (query.data) return { status: 'ready', allowed: canAccess(access, query.data.permissions) };
  return { status: 'loading' };
}
