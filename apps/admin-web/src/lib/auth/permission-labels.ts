import { findPermission } from '@permission-catalog';

/** 권한 키 → 화면 이름. 목록에 없는 키는 키 그대로(지어내지 않는다). */
export function permissionLabel(key: string): string {
  return findPermission(key)?.label ?? key;
}

/** 강제 모드 403 본문(`requiredPermissions`)에서만 읽는다. 옛 가드 403 이면 빈 목록. */
export function readRequiredPermissions(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('requiredPermissions' in body)) return [];
  const value: unknown = body.requiredPermissions;
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is string => typeof key === 'string');
}
