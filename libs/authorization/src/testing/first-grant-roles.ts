import { INITIAL_GRANT_ROLES, PERMISSION_CATALOG, Permission } from '../permissions/permission-catalog';

/**
 * 역할별 권한 사본의 스펙용 기본값. 카탈로그의 첫 등록 부여를 역할별로 모으고, master 는 카탈로그 전체를 받는다
 * (user-service 가 master 에 활성 권한 전부를 주는 것과 같다).
 */
function buildFirstGrantRolePermissions(): Readonly<Record<string, readonly Permission[]>> {
  const byRole: Record<string, readonly Permission[]> = {};
  for (const role of INITIAL_GRANT_ROLES) {
    byRole[role] = PERMISSION_CATALOG.filter((p) => p.grantOnFirstRegistration.some((r) => r === role)).map(
      (p) => p.key,
    );
  }
  byRole.master = PERMISSION_CATALOG.map((p) => p.key);
  return Object.freeze(byRole);
}

export const FIRST_GRANT_ROLE_PERMISSIONS = buildFirstGrantRolePermissions();
