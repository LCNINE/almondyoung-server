'use client';

import type { Permission } from '@permission-catalog';
import type { MyRole } from '@/lib/auth/my-permissions';
import type { PermissionedAction } from '@/lib/auth/mutation-permission';
import { checkCan, openState, permissionCheckFrom, runState, type CanState } from '@/lib/auth/permission-check';
import { useMyPermissions } from '@/lib/services/users';

/** 버튼·섹션 판정. 로딩·실패를 «권한 없음»으로 뭉개지 않는다 — 호출하는 쪽은 `status` 를 본다. */
export function useCan(anyOf: readonly Permission[]): CanState {
  const query = useMyPermissions();
  return checkCan(query, anyOf);
}

const NONE: ReadonlySet<string> = new Set();

export function usePermissions(): {
  status: CanState['status'];
  roles: readonly MyRole[];
  permissions: ReadonlySet<string>;
} {
  const query = useMyPermissions();
  return {
    status: query.data ? 'ready' : query.isError ? 'error' : 'loading',
    roles: query.data?.roles ?? [],
    permissions: query.data?.permissions ?? NONE,
  };
}

/** 쓰기 동작(뮤테이션 훅) 여럿을 함께 판정 — 훅이 선언한 권한을 쓴다. 버튼에 권한 키를 다시 적지 않는다. */
export function useCanRun(...actions: PermissionedAction[]): CanState {
  return runState(useMyPermissions(), actions);
}

/** 다른 화면으로 가는 링크·버튼 — 그 화면의 진입 권한표로 판정한다. */
export function useCanOpen(screen: string): CanState {
  return openState(useMyPermissions(), screen);
}

/**
 * 한 화면에서 여러 버튼을 판정할 때. 확인하지 못한 동안은 `isPermissionLoading` 이 true 다.
 * `canRun(useX)` — 쓰기 트리거를 그릴지(조회 실패면 그린다), `blockedReason(useX)` — 값을 보여 주는 컨트롤을 비활성으로 둘 이유.
 */
export function usePermissionCheck(): {
  can: (anyOf: readonly Permission[]) => boolean;
  isPermissionLoading: boolean;
  canRun: (...actions: PermissionedAction[]) => boolean;
  blockedReason: (...actions: PermissionedAction[]) => string | null;
} {
  return permissionCheckFrom(useMyPermissions());
}
