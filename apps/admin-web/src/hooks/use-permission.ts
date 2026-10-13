'use client';

import type { Permission } from '@permission-catalog';
import type { MyRole } from '@/lib/auth/my-permissions';
import { checkCan, permissionCheckFrom, type CanState } from '@/lib/auth/permission-check';
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

/** 한 화면에서 여러 버튼을 판정할 때. 확인하지 못한 동안은 `isPermissionLoading` 이 true 다. */
export function usePermissionCheck(): { can: (anyOf: readonly Permission[]) => boolean; isPermissionLoading: boolean } {
  return permissionCheckFrom(useMyPermissions());
}
