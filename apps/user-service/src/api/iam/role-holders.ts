import type { Permission, PermissionCache } from '@app/authorization';

/** 역할별 권한 사본을 아직 받지 못했다 — «아무도 없음»이 아니라 판정 불가다. */
export class RoleHoldersUnavailableError extends Error {
  constructor() {
    super('role permission copy is not loaded yet');
  }
}

export type RoleHolderLookup = Pick<PermissionCache, 'rolesHolding'>;

/** 이 권한을 가진 역할 이름. 사본이 없으면 판정 불가 예외를 던진다. */
export function rolesHoldingOrThrow(lookup: RoleHolderLookup, permission: Permission): readonly string[] {
  const roles = lookup.rolesHolding(permission);

  if (roles === null) {
    throw new RoleHoldersUnavailableError();
  }

  return roles;
}
