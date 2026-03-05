'use client';

import { useMyRoles } from '@/lib/services/users';

export function usePermission() {
  const { data: myRoles, isLoading: isPermissionLoading } = useMyRoles();

  // 역할 체크 (master, admin)
  const hasRole = (roleNames: string[]) =>
    myRoles?.roles.some((r) => roleNames.includes(r.role.name));

  // 권한 체크 (master, admin:user-read, admin:user-write, admin:user-delete... )
  const hasScope = (scopeNames: string[]) =>
    myRoles?.roles.some((s) =>
      scopeNames.some((scopeName) => scopeName === s.scopes.scope_name)
    );

  return { hasRole, hasScope, isPermissionLoading };
}
